// Phase F1.1 — bump the 4 tunya NPCs with 5 blocks to 6.
// Looks for missing Solnus or Dominus block and appends.

import { readFileSync, writeFileSync } from "node:fs";

const FILE = "content/world/tunya/npcs.json";
const arr = JSON.parse(readFileSync(FILE, "utf8"));

const ADDITIONS = {
  lord_curator_renn_asbir: {
    phase: "Solnus", phase_hours: [21, 24],
    location: "asbir_curator_residence",
    activity: "private study; writes the next day's archive briefings",
    need_addressed: "archive_work",
    interactable_by_player: false,
  },
  elder_walker_neyahwetin: {
    phase: "Solnus", phase_hours: [21, 24],
    location: "nil_elder_grove",
    activity: "night-walks the spirit paths; reads the stars",
    need_addressed: "spirit_walk",
    interactable_by_player: false,
  },
  "grove-mother_yenna_nil": {
    phase: "Solnus", phase_hours: [21, 24],
    location: "nil_grove_mother_residence",
    activity: "private rituals; tends the sacred fire",
    need_addressed: "spirit_walk",
    interactable_by_player: false,
  },
  high_mason_torrek_masond: {
    phase: "Solnus", phase_hours: [21, 24],
    location: "masond_high_mason_residence",
    activity: "studies blueprints; writes commission ledgers",
    need_addressed: "masonry",
    interactable_by_player: false,
  },
};

let patched = 0;
for (const npc of arr) {
  const add = ADDITIONS[npc.id];
  if (!add) continue;
  if (!Array.isArray(npc.daily_schedule)) continue;
  // Check if we already have a Solnus block (don't duplicate).
  if (npc.daily_schedule.some((b) => b.phase === add.phase)) continue;
  npc.daily_schedule.push(add);
  patched++;
}
writeFileSync(FILE, JSON.stringify(arr, null, 2) + "\n", "utf8");
console.log({ patched });
