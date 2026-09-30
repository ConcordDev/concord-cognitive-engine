import type { WorldId } from "./content";
import type { BeastKind } from "./worlds";

/** Off-hub realm radius in meters. Diameter ≈ 3.4 km. Hub stays a plaza. */
export const REALM_RADIUS = 1700;
export const PLAZA_RADIUS = 28;
export const LIFE_RADIUS = 240;
export const ROAD_HALF = 4.2;

export type Settlement = {
  id: string;
  worldId: WorldId;
  name: string;
  x: number;
  z: number;
  faction: string;
  purpose: string;
  kind: "town" | "keep" | "camp" | "yard" | "spire" | "grove";
};

export const SETTLEMENTS: Record<WorldId, Settlement[]> = {
  "concordia-hub": [],
  "sovereign-ruins": [
    { id: "sr-ossuary", worldId: "sovereign-ruins", name: "The Ossuary Choir", x: 480, z: -220, faction: "glyph-keepers", purpose: "catalogue the still-dying", kind: "keep" },
    { id: "sr-unburied", worldId: "sovereign-ruins", name: "Unburied Ward", x: -410, z: 560, faction: "court-unburned", purpose: "refuse a final ending", kind: "town" },
    { id: "sr-ashroad", worldId: "sovereign-ruins", name: "Ash-Road Camp", x: 720, z: 640, faction: "glyph-keepers", purpose: "walk remnants without conquering them", kind: "camp" },
    { id: "sr-choir-rim", worldId: "sovereign-ruins", name: "West Arch Roost", x: -980, z: -740, faction: "glyph-keepers", purpose: "the griffin that will not be hunted", kind: "keep" },
    { id: "sr-last-name", worldId: "sovereign-ruins", name: "Last-Name Field", x: 1180, z: 420, faction: "court-unburned", purpose: "names that have not finished being said", kind: "camp" },
  ],
  tunya: [
    { id: "ty-mesa", worldId: "tunya", name: "Mesa-Hand", x: 620, z: 180, faction: "verdant-veil", purpose: "negotiate with soil", kind: "grove" },
    { id: "ty-rim", worldId: "tunya", name: "Harvest Rim", x: -540, z: -420, faction: "verdant-veil", purpose: "fire that is never fully taken", kind: "camp" },
    { id: "ty-well", worldId: "tunya", name: "Well of the Second Drought", x: 180, z: 780, faction: "verdant-veil", purpose: "listen when the grove goes quiet", kind: "grove" },
    { id: "ty-pollen", worldId: "tunya", name: "Pollen Court", x: -1100, z: 520, faction: "verdant-veil", purpose: "the soil speaking back", kind: "town" },
    { id: "ty-second", worldId: "tunya", name: "Spine of Refusals", x: 940, z: -860, faction: "verdant-veil", purpose: "where the Eight were written", kind: "grove" },
  ],
  fantasy: [
    { id: "fa-grove", worldId: "fantasy", name: "Quiet Grove", x: -480, z: 260, faction: "sundering-guard", purpose: "hold the curse inward", kind: "grove" },
    { id: "fa-wall", worldId: "fantasy", name: "North Wall", x: 90, z: -720, faction: "sundering-guard", purpose: "a griffin older than the Sundering", kind: "keep" },
    { id: "fa-ward", worldId: "fantasy", name: "Ward-Court", x: 640, z: 420, faction: "sundering-guard", purpose: "train without becoming the thing", kind: "town" },
    { id: "fa-held", worldId: "fantasy", name: "Held-Gaze Hollow", x: 1080, z: -380, faction: "sundering-guard", purpose: "the basilisk that is a lesson", kind: "keep" },
    { id: "fa-restraint", worldId: "fantasy", name: "Restraint Camp", x: -920, z: 860, faction: "sundering-guard", purpose: "defeat that is not losing", kind: "camp" },
  ],
  crime: [
    { id: "cr-delgado", worldId: "crime", name: "Delgado Yard", x: -560, z: 140, faction: "delgado", purpose: "keep people across worlds", kind: "yard" },
    { id: "cr-invoice", worldId: "crime", name: "Invoice Street", x: 510, z: -380, faction: "ghost-contracts", purpose: "the bill always arrives", kind: "town" },
    { id: "cr-weather", worldId: "crime", name: "Cop-Weather Precinct", x: 220, z: 690, faction: "beat", purpose: "cops are a weather system", kind: "yard" },
    { id: "cr-split", worldId: "crime", name: "Three-World Split", x: -1020, z: -640, faction: "delgado", purpose: "people kept in more than one door", kind: "town" },
    { id: "cr-late", worldId: "crime", name: "Late Invoice Docks", x: 1240, z: 280, faction: "ghost-contracts", purpose: "delay is not cancellation", kind: "yard" },
  ],
  cyber: [
    { id: "cy-blackout", worldId: "cyber", name: "Blackout Stack", x: -440, z: -280, faction: "uncounted", purpose: "organize people the Grid will not number", kind: "spire" },
    { id: "cy-census", worldId: "cyber", name: "Census Spire", x: 580, z: 160, faction: "grid", purpose: "he counts", kind: "spire" },
    { id: "cy-null", worldId: "cyber", name: "Null Market", x: 120, z: 740, faction: "uncounted", purpose: "damage that refuses to display", kind: "town" },
    { id: "cy-skip", worldId: "cyber", name: "Four-Skip Archive", x: 980, z: -720, faction: "grid", purpose: "the numbers that went missing", kind: "spire" },
    { id: "cy-variable", worldId: "cyber", name: "Variable Alley", x: -880, z: 1040, faction: "uncounted", purpose: "guests the census cannot file", kind: "town" },
  ],
  "concord-link-frontier": [
    { id: "fr-wagon", worldId: "concord-link-frontier", name: "Wagon Circle", x: 540, z: -160, faction: "road-walkers", purpose: "the road is the door", kind: "camp" },
    { id: "fr-scrub", worldId: "concord-link-frontier", name: "Scrub Relay", x: -620, z: 380, faction: "road-walkers", purpose: "no seat at the Ring — fine", kind: "camp" },
    { id: "fr-rim", worldId: "concord-link-frontier", name: "Dome-Break", x: 200, z: 820, faction: "road-walkers", purpose: "drop the dome; wind will do the rest", kind: "town" },
    { id: "fr-seatless", worldId: "concord-link-frontier", name: "Seatless Rest", x: -1140, z: -520, faction: "road-walkers", purpose: "an embassy that is a road", kind: "camp" },
    { id: "fr-wind", worldId: "concord-link-frontier", name: "Wind Architecture", x: 1320, z: 640, faction: "road-walkers", purpose: "no outer wall on purpose", kind: "town" },
  ],
  superhero: [
    { id: "sh-slab", worldId: "superhero", name: "East Slab", x: 600, z: -240, faction: "luminary", purpose: "charities that keep people too comfortable to ask", kind: "spire" },
    { id: "sh-bottom", worldId: "superhero", name: "Two Streets Over", x: -520, z: 310, faction: "anti-sovereign", purpose: "fight up from the bottom", kind: "town" },
    { id: "sh-dawn", worldId: "superhero", name: "Unfinished Sunrise", x: 80, z: 760, faction: "enforcer", purpose: "if I win this sunrise I become the Luminary", kind: "keep" },
    { id: "sh-fed", worldId: "superhero", name: "Fed Half", x: 1080, z: 540, faction: "luminary", purpose: "the half of the city that eats", kind: "spire" },
    { id: "sh-ask", worldId: "superhero", name: "The Asking Street", x: -960, z: -780, faction: "anti-sovereign", purpose: "the half that still asks who owns the debt", kind: "town" },
  ],
  "lattice-crucible": [
    { id: "lc-second", worldId: "lattice-crucible", name: "Second Hour", x: -380, z: -420, faction: "open-lattice", purpose: "there is no ninth", kind: "spire" },
    { id: "lc-drift", worldId: "lattice-crucible", name: "Drift Gallery", x: 640, z: 180, faction: "open-lattice", purpose: "catalogue events that will not stay catalogued", kind: "town" },
    { id: "lc-wyrm", worldId: "lattice-crucible", name: "Unfinished Weather", x: 140, z: 700, faction: "open-lattice", purpose: "a dragon that refused to finish", kind: "keep" },
    { id: "lc-ninth", worldId: "lattice-crucible", name: "No-Ninth Stair", x: 1120, z: -640, faction: "open-lattice", purpose: "the art that will not be taught", kind: "spire" },
    { id: "lc-open", worldId: "lattice-crucible", name: "Open Door Camp", x: -860, z: 980, faction: "open-lattice", purpose: "keep the door, refuse completion", kind: "camp" },
  ],
};

export const REALM_FAUNA: Record<WorldId, BeastKind[]> = {
  "concordia-hub": [],
  "sovereign-ruins": ["wraith", "dragon", "griffin", "spider", "golem"],
  tunya: ["sealie", "wolf", "serpent", "harpy"],
  fantasy: ["dragon", "wolf", "basilisk", "griffin", "serpent"],
  crime: ["hound", "construct", "spider", "drone"],
  cyber: ["drone", "sentinel", "construct", "drift"],
  "concord-link-frontier": ["wolf", "harpy", "serpent", "hound"],
  superhero: ["construct", "drone", "harpy", "sentinel"],
  "lattice-crucible": ["drift", "dragon", "wyrm", "golem"],
};

export function settlementsOf(id: WorldId): Settlement[] {
  return SETTLEMENTS[id] ?? [];
}

export function defaultOwners(world: WorldId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of settlementsOf(world)) out[s.id] = s.faction;
  return out;
}

export function rivalSettlement(world: WorldId, factionId: string): Settlement | null {
  const towns = settlementsOf(world);
  return towns.find((t) => t.faction !== factionId) ?? towns[1] ?? null;
}

export function nearestSettlement(id: WorldId, x: number, z: number): { s: Settlement; d: number } | null {
  let best: { s: Settlement; d: number } | null = null;
  for (const s of settlementsOf(id)) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (!best || d < best.d) best = { s, d };
  }
  return best;
}

export function onRoad(id: WorldId, x: number, z: number): boolean {
  for (const s of settlementsOf(id)) {
    const dx = s.x;
    const dz = s.z;
    const len = Math.hypot(dx, dz) || 1;
    const t = Math.max(0, Math.min(1, (x * dx + z * dz) / (len * len)));
    const px = dx * t;
    const pz = dz * t;
    if (Math.hypot(x - px, z - pz) < ROAD_HALF + 1.2) return true;
  }
  return false;
}
