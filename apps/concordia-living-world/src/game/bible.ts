import type { WorldId } from "./content";

/** Lore → law → mechanic. Nothing in here is allowed to stay decorative. */
export type WorldLaw = {
  id: string;
  text: string;
  mechanic: string;
};

export type FactionDef = {
  id: string;
  name: string;
  want: string;
  worldId: WorldId | "cross";
};

export type WorldBible = {
  id: WorldId;
  thesis: string;
  refusal: string;
  signatureCreature: string;
  signatureLocation: string;
  signatureEvent: string;
  signatureMechanic: string;
  kingdoms: string[];
  laws: WorldLaw[];
  lore: { id: string; text: string; realization: string }[];
};

export const FACTIONS: FactionDef[] = [
  { id: "glyph-keepers", name: "Glyph Keepers", want: "catalogue, never finish dying", worldId: "sovereign-ruins" },
  { id: "court-unburned", name: "Court Unburned", want: "endings that will not stay ended", worldId: "sovereign-ruins" },
  { id: "verdant-veil", name: "Verdant Veil", want: "soil that cannot be reaped", worldId: "tunya" },
  { id: "sundering-guard", name: "Sundering Guard", want: "win without becoming the dragon", worldId: "fantasy" },
  { id: "delgado", name: "Delgado Syndicate", want: "people kept across worlds", worldId: "crime" },
  { id: "ghost-contracts", name: "Ghost Contracts", want: "consequence delayed, never cancelled", worldId: "crime" },
  { id: "beat", name: "Beat Weather", want: "order as climate, not justice", worldId: "crime" },
  { id: "uncounted", name: "The Uncounted", want: "to not be a number", worldId: "cyber" },
  { id: "grid", name: "The Grid", want: "every guest counted", worldId: "cyber" },
  { id: "road-walkers", name: "Frontier Walkers", want: "a seat, or a road that is a door", worldId: "concord-link-frontier" },
  { id: "luminary", name: "Luminary Charities", want: "comfort that asks no questions", worldId: "superhero" },
  { id: "anti-sovereign", name: "Anti-Sovereign", want: "the war two streets over", worldId: "superhero" },
  { id: "enforcer", name: "The Enforcer", want: "a sunrise that does not finish", worldId: "superhero" },
  { id: "open-lattice", name: "Open Lattice", want: "refuse completion, refuse a ninth", worldId: "lattice-crucible" },
  { id: "crimson-court", name: "Crimson Court", want: "blackmail dressed as etiquette", worldId: "concordia-hub" },
  { id: "ring", name: "The Ring", want: "eight doors, one heart that cannot be owned", worldId: "cross" },
];

export const BIBLES: Record<WorldId, WorldBible> = {
  "concordia-hub": {
    id: "concordia-hub",
    thesis: "The hub is not between worlds. It is the refusal to choose among them.",
    refusal: "You cannot own the heart.",
    signatureCreature: "none — guests, not wildlife",
    signatureLocation: "The Unburned Court",
    signatureEvent: "A scheme overheard between embassies",
    signatureMechanic: "Blades die as flowers except in the Arena",
    kingdoms: ["Crimson Court", "Grid embassy", "Frontier walkers (no seat)"],
    laws: [
      { id: "HUB-L1", text: "No live steel in the Court", mechanic: "attacks outside Arena become flowers" },
      { id: "HUB-L2", text: "Guests do not die here", mechanic: "hp=0 respawns; the ground catches you" },
    ],
    lore: [
      { id: "LORE-HUB-001", text: "You cannot own the heart", realization: "flower-law + Lamplighter line" },
      { id: "LORE-HUB-002", text: "Eight doors, eight refusals", realization: "Ring of Doors gates" },
      { id: "LORE-HUB-003", text: "Living make plots; the ground does not", realization: "scheme toasts + barge" },
    ],
  },
  "sovereign-ruins": {
    id: "sovereign-ruins",
    thesis: "Death is unstable. Archaeology, not conquest.",
    refusal: "We will not allow our ending to be final.",
    signatureCreature: "Ash-drake / Unburied wraith",
    signatureLocation: "Ring of broken arches (Godot plaza) → Ossuary Choir",
    signatureEvent: "An unburial — a fallen thing stands because the world refuses the ending",
    signatureMechanic: "Revive timers; G refuses ending; 1 hurries unburial",
    kingdoms: ["Glyph Keepers", "Court Unburned"],
    laws: [
      { id: "SR-L1", text: "Death is unstable", mechanic: "wraiths/drake reviveMs > 0" },
      { id: "SR-L2", text: "Ashfall eases the unburied", mechanic: "weather ash → revive faster via ecology" },
      { id: "SR-L3", text: "Catalogue, do not conquer", mechanic: "hostility raises keeper heat; quests prefer study" },
    ],
    lore: [
      { id: "LORE-SR-001", text: "Nothing here has finished", realization: "revive + Ossuary NPC" },
      { id: "LORE-SR-002", text: "Wraiths remember how to stand", realization: "wraith reviveMs 7000" },
      { id: "LORE-SR-047", text: "Unburial ritual", realization: "G Keepers special + waystone unburial event" },
      { id: "LORE-SR-082", text: "Wraith memory", realization: "kernel memories on knockdown" },
      { id: "LORE-SR-119", text: "Ash-drake territory", realization: "drake orbits plaza, aggro 22m" },
      { id: "LORE-SR-143", text: "Death refusal quest branch", realization: "mercy quest + unburial world event" },
    ],
  },
  tunya: {
    id: "tunya",
    thesis: "We fled Earth because it reaped us. The soil is a party to the treaty.",
    refusal: "We will not be reaped.",
    signatureCreature: "Sealie / desert snake",
    signatureLocation: "Grove-ring + Well of the Second Drought",
    signatureEvent: "The grove goes quiet, then speaks in pollen",
    signatureMechanic: "Inner grove restores poise if you are not striking; G heals",
    kingdoms: ["Verdant Veil"],
    laws: [
      { id: "TY-L1", text: "Do not take the tree", mechanic: "grove poise regen; reap (combat in grove) raises hostility" },
      { id: "TY-L2", text: "Second Drought still listens", mechanic: "need hunger pulses; prices follow harvest" },
    ],
    lore: [
      { id: "LORE-TY-001", text: "Eight Refusals written here", realization: "Iyatte lines + hub Ring" },
      { id: "LORE-TY-002", text: "Take fruit, not the tree", realization: "grove mechanic" },
      { id: "LORE-TY-003", text: "Second Drought still listens", realization: "need hunger pulses + harvest prices" },
    ],
  },
  fantasy: {
    id: "fantasy",
    thesis: "Winning with the curse is becoming the dragon.",
    refusal: "I will not become the thing destroying me.",
    signatureCreature: "Sundering Drake",
    signatureLocation: "Quiet Grove / North Wall griffin",
    signatureEvent: "Hostility turns inward — your own poise pays the curse",
    signatureMechanic: "hostility > 8 self-damage; G turns curse inward",
    kingdoms: ["Sundering Guard"],
    laws: [
      { id: "FA-L1", text: "Hostility is the curse", mechanic: "kernel.hostility self-hit" },
      { id: "FA-L2", text: "The dragon will not be finished", mechanic: "drake revive + dawn-like hp floor off" },
    ],
    lore: [
      { id: "LORE-FA-001", text: "Thorne walks the grove instead of ending it", realization: "NPC + hostility law" },
    ],
  },
  crime: {
    id: "crime",
    thesis: "Consequence is a bill. Delay is not cancellation.",
    refusal: "What we do will not catch up to us. (The world disagrees.)",
    signatureCreature: "Walker hound / beat construct",
    signatureLocation: "Delgado Yard / Invoice Street",
    signatureEvent: "A delayed hit invoices you in a breath",
    signatureMechanic: "ghost delayed damage; G delays, 1 collects",
    kingdoms: ["Delgado Syndicate", "Ghost Contracts", "Beat Weather"],
    laws: [
      { id: "CR-L1", text: "Hits land late", mechanic: "delayed[] kernel queue" },
      { id: "CR-L2", text: "Cops are weather", mechanic: "rain + beat construct patrol" },
    ],
    lore: [
      { id: "LORE-CR-001", text: "Mama does not sleep in the same world twice", realization: "cross-world NPC presence + plot-bill" },
      { id: "LORE-CR-002", text: "Delay is not cancellation", realization: "ghost delayed damage + invoice event" },
    ],
  },
  cyber: {
    id: "cyber",
    thesis: "To be counted is to be owned. The joke is in the name Zero.",
    refusal: "I will not be counted.",
    signatureCreature: "Census drone",
    signatureLocation: "Blackout Stack / Census Spire",
    signatureEvent: "The Grid skips four numbers",
    signatureMechanic: "uncounted damage bar; G flushes display; 1 dumps as AOE",
    kingdoms: ["The Uncounted", "The Grid"],
    laws: [
      { id: "CY-L1", text: "Damage refuses to number until combo breaks", mechanic: "uncounted accumulator" },
      { id: "CY-L2", text: "Census classifies guests", mechanic: "drones aggro; identity heat" },
    ],
    lore: [
      { id: "LORE-CY-001", text: "Nyx organizes the uncounted", realization: "NPC + uncounted bar" },
    ],
  },
  "concord-link-frontier": {
    id: "concord-link-frontier",
    thesis: "A dome is a refusal of the road. They have no seat. The road is the door.",
    refusal: "The road is our door.",
    signatureCreature: "Scrub wolf / cliff condor",
    signatureLocation: "Wagon Circle / Dome-Break",
    signatureEvent: "Wind argues with anyone still wearing a dome",
    signatureMechanic: "sprint lives here; road bonus; wind drift",
    kingdoms: ["Frontier Walkers"],
    laws: [
      { id: "FR-L1", text: "No outer wall — wind is architecture", mechanic: "large bound, few walls, wind push" },
      { id: "FR-L2", text: "Sprint is native", mechanic: "speedMul 1.25 + road 1.35" },
    ],
    lore: [
      { id: "LORE-FR-001", text: "Still no seat at the Ring", realization: "hub ticker + Ren lines" },
    ],
  },
  superhero: {
    id: "superhero",
    thesis: "The final victory is a tyrant. Mercy is the special.",
    refusal: "I will not take the final victory.",
    signatureCreature: "Dawn construct",
    signatureLocation: "Unfinished Sunrise / Two Streets Over",
    signatureEvent: "A knockdown that will not end",
    signatureMechanic: "hp floor; G restores the fallen; 1 mercy-shock leaves them at 1",
    kingdoms: ["Luminary", "Anti-Sovereign", "Enforcer"],
    laws: [
      { id: "SH-L1", text: "Knockdowns do not end", mechanic: "dawn hp floor + construct revive" },
      { id: "SH-L2", text: "Refuse the win", mechanic: "G stands them up" },
    ],
    lore: [
      { id: "LORE-SH-001", text: "If I win this sunrise I become the Luminary", realization: "Elias + hp floor" },
    ],
  },
  "lattice-crucible": {
    id: "lattice-crucible",
    thesis: "A thing that refuses completion cannot be written down.",
    refusal: "The Eighth Refusal.",
    signatureCreature: "Lattice Drake / unfinished wyrm",
    signatureLocation: "Second Hour / Unfinished Weather",
    signatureEvent: "A drift-event walks the plaza",
    signatureMechanic: "terrain drift; G AOE un-end; 1 rumble",
    kingdoms: ["Open Lattice"],
    laws: [
      { id: "LC-L1", text: "Nothing is allowed to finish", mechanic: "revive + drift births" },
      { id: "LC-L2", text: "There is no ninth", mechanic: "Lyra will not teach; quests refuse a ninth art" },
    ],
    lore: [
      { id: "LORE-LC-001", text: "I will not teach a ninth", realization: "Lyra lines + quest generator skip" },
    ],
  },
};

export const CROSS_PLOTS = [
  {
    id: "plot-eighth",
    title: "The Eighth Door",
    worlds: ["lattice-crucible", "tunya", "concordia-hub"] as WorldId[],
    text: "Lyra will not teach a ninth. Iyatte says the Refusals were written in Tunya. The Ring is the practice of not choosing.",
  },
  {
    id: "plot-uncounted",
    title: "The Uncounted Ledger",
    worlds: ["cyber", "concordia-hub"] as WorldId[],
    text: "Nyx organizes. Zero files you as a variable. The Grid skips four numbers and someone goes missing from a census.",
  },
  {
    id: "plot-curse",
    title: "The Held Curse",
    worlds: ["fantasy", "concordia-hub"] as WorldId[],
    text: "Thorne could end the dragon. He would become it. Hostility you feed in the Sundering follows you home as a rumor.",
  },
  {
    id: "plot-road",
    title: "No Seat at the Ring",
    worlds: ["concord-link-frontier", "concordia-hub"] as WorldId[],
    text: "Frontier walkers still have no embassy chair. Every road you walk is an argument for a ninth door that is not a door.",
  },
  {
    id: "plot-bill",
    title: "The Invoice Follows",
    worlds: ["crime", "concordia-hub"] as WorldId[],
    text: "Mama does not sleep in the same world twice. A delayed hit in the yard becomes a courtesy in the Court.",
  },
];

export function bible(id: WorldId): WorldBible {
  return BIBLES[id];
}
