// Phase F1.1 — backfill starting_sparks on every authored NPC.
//
// Sparks are the Concord currency. Archetype-tier defaults:
//   noble / warlord       → 12000
//   warrior / mystic      → 4000
//   scholar / healer      → 3500
//   guard / trader        → 2500
//   hunter                → 2000
//   default / child       → 600

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";

const TIER = {
  noble: 12000, warlord: 12000,
  warrior: 4000, mystic: 4000,
  scholar: 3500, healer: 3500,
  guard: 2500, trader: 2500,
  hunter: 2000,
  default: 600,
};

let total = 0, patched = 0;
const dirs = readdirSync("content/world").filter(d => statSync("content/world/" + d).isDirectory() && d !== "_shared");
for (const d of dirs) {
  for (const f of ["npcs.json", "npcs-extra.json"]) {
    const path = `content/world/${d}/${f}`;
    let arr; try { arr = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    for (const npc of arr) {
      total++;
      if (typeof npc.starting_sparks === "number" && npc.starting_sparks > 0) continue;
      const arch = (npc.archetype || "default").toLowerCase();
      npc.starting_sparks = TIER[arch] ?? TIER.default;
      patched++;
    }
    writeFileSync(path, JSON.stringify(arr, null, 2) + "\n", "utf8");
  }
}
console.log({ total, patched });
