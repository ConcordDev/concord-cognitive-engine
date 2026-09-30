export type WorldId =
  | "concordia-hub"
  | "sovereign-ruins"
  | "tunya"
  | "fantasy"
  | "crime"
  | "cyber"
  | "concord-link-frontier"
  | "superhero"
  | "lattice-crucible";

export type GateDef = {
  id: string;
  worldId: WorldId;
  name: string;
  refusal: string;
  theNo: string;
  color: string;
  angle: number;
};

export type NpcDef = {
  id: string;
  name: string;
  title: string;
  color: string;
  accent: string;
  height: number;
  x: number;
  z: number;
  wander: number;
  lines: string[];
  secret?: string;
};

export const GATES: GateDef[] = [
  {
    id: "gate-ruins",
    worldId: "sovereign-ruins",
    name: "Sovereign Ruins",
    refusal: "Refusal of Death",
    theNo: "We will not allow our ending to be final.",
    color: "#b89060",
    angle: 0,
  },
  {
    id: "gate-tunya",
    worldId: "tunya",
    name: "Tunya",
    refusal: "Refusal of Harvest",
    theNo: "We will not be reaped.",
    color: "#c8721a",
    angle: Math.PI / 4,
  },
  {
    id: "gate-fantasy",
    worldId: "fantasy",
    name: "The Sundering",
    refusal: "Refusal of Hostility",
    theNo: "I will not become the thing destroying me.",
    color: "#3a8a5c",
    angle: Math.PI / 2,
  },
  {
    id: "gate-crime",
    worldId: "crime",
    name: "Crime World",
    refusal: "Refusal of Consequence",
    theNo: "What we do will not catch up to us.",
    color: "#8a6a48",
    angle: (Math.PI * 3) / 4,
  },
  {
    id: "gate-cyber",
    worldId: "cyber",
    name: "The Grid",
    refusal: "Refusal of Numbers",
    theNo: "I will not be counted.",
    color: "#c45aa8",
    angle: Math.PI,
  },
  {
    id: "gate-frontier",
    worldId: "concord-link-frontier",
    name: "The Frontier",
    refusal: "Refusal of the Dome",
    theNo: "The road is our door.",
    color: "#88c0ff",
    angle: (Math.PI * 5) / 4,
  },
  {
    id: "gate-hero",
    worldId: "superhero",
    name: "The Permanent Dawn",
    refusal: "Refusal of the Win",
    theNo: "I will not take the final victory.",
    color: "#3a78ff",
    angle: (Math.PI * 3) / 2,
  },
  {
    id: "gate-crucible",
    worldId: "lattice-crucible",
    name: "The Crucible",
    refusal: "The Eighth Refusal",
    theNo: "A thing that refuses completion cannot be written down.",
    color: "#20ffd0",
    angle: (Math.PI * 7) / 4,
  },
];

export const RING_RADIUS = 20;
export const COURT_RADIUS = 11;
export const WALL_RADIUS = 48;
export const ARENA = { x: 0, z: 32, r: 8 };
export const SPAWN = { x: 15.5, z: 0, yaw: Math.PI / 2 };

export const NPCS: NpcDef[] = [
  {
    id: "lamplighter",
    name: "The Lamplighter",
    title: "Eastern path",
    color: "#c8b48a",
    accent: "#ffd890",
    height: 1.72,
    x: 21.2,
    z: 0.7,
    wander: 0.7,
    lines: [
      "The lamps are already lit. I walk them anyway.",
      "The hub is not a place between the worlds. It is the refusal to choose among them.",
      "To those who have just arrived: one true sentence. You cannot own the heart. She will not even dignify the attempt with anger.",
      "Walk the Ring. Listen. The living make plots; the ground does not.",
    ],
  },
  {
    id: "elias",
    name: "Elias Voss",
    title: "Anti-Sovereign",
    color: "#3d4a62",
    accent: "#c8d4e8",
    height: 1.84,
    x: -8,
    z: 10,
    wander: 2.4,
    lines: [
      "He watches from a tower. I work two streets over. That's the whole war.",
      "Vesper funds the charities that keep people too comfortable to ask who owns the debt.",
      "If you want a fight, take it to the Arena. Concordia herself ended the last conquest with flowers.",
    ],
    secret: "The Voss genealogy is sealed for a reason that is not etiquette.",
  },
  {
    id: "vesper",
    name: "Vesper Kane",
    title: "Luminary",
    color: "#e8e4dc",
    accent: "#a860ff",
    height: 1.78,
    x: 6,
    z: -9,
    wander: 2,
    lines: [
      "I keep half this city fed. The other half I keep honest.",
      "Elias thinks comfort is a muzzle. He has never been hungry.",
      "The Permanent Dawn will not end because ending it would make one of us a tyrant.",
    ],
  },
  {
    id: "seraphine",
    name: "Lady Seraphine Voss",
    title: "Crimson Court",
    color: "#6a2030",
    accent: "#e8c0c8",
    height: 1.76,
    x: 12,
    z: 12,
    wander: 1.6,
    lines: [
      "We trade in blackmail dressed as etiquette. Do smile when you object.",
      "Elias and I share a name. We do not share a table.",
      "The Court Unburned in the ruins and this plaza are the same act, attempted at two scales.",
    ],
  },
  {
    id: "jax",
    name: "Jax Rivera",
    title: "The Ghost",
    color: "#2a241c",
    accent: "#c4a070",
    height: 1.8,
    x: -14,
    z: -4,
    wander: 3.2,
    lines: [
      "Contracts from all eight. Loyalty from none. That's how you stay a guest.",
      "My world refuses consequence so completely it refused even the knowledge of the Refusals.",
      "If something follows you home, that's not my problem. That's the point.",
    ],
  },
  {
    id: "mama",
    name: "Mama Iron Rose",
    title: "Delgado Syndicate",
    color: "#5c3038",
    accent: "#e0a0a8",
    height: 1.62,
    x: -16,
    z: 8,
    wander: 2,
    lines: [
      "I do not sleep in the same world twice. That is how I keep my people.",
      "The hub is mercy. Do not confuse it with softness.",
      "You want a blade, go to the Arena. You want a family, you come to me.",
    ],
  },
  {
    id: "zero",
    name: "Kael Nakamura",
    title: "Zero",
    color: "#1a1028",
    accent: "#ff2bd5",
    height: 1.86,
    x: -12,
    z: -12,
    wander: 1.2,
    lines: [
      "I uploaded a city-sized mind so I would not have to be one number. The joke is in the name.",
      "I no longer know which clone is original. I have refused the number that would tell me.",
      "The Sovereign is the one thing that cannot be counted. I am studying the gap.",
    ],
    secret: "Zero has not known which clone is original for six months.",
  },
  {
    id: "nyx",
    name: "Nyx Torres",
    title: "Blackout",
    color: "#12121a",
    accent: "#30e8ff",
    height: 1.7,
    x: -10.5,
    z: -14,
    wander: 1.8,
    lines: [
      "He counts. I organize the uncounted.",
      "We share an embassy. We do not share a future.",
      "If you overhear us, you were meant to. That's how a scheme works in a city that forbids knives.",
    ],
  },
  {
    id: "thorne",
    name: "Thorne Blackroot",
    title: "The Sundering",
    color: "#1a3028",
    accent: "#60ffc0",
    height: 1.96,
    x: 14,
    z: -8,
    wander: 2.6,
    lines: [
      "I carry a curse I could turn outward and win with. I refuse, every day.",
      "The forests go quiet around me because restraint, held long enough, looks like defeat.",
      "I come to the hub only at night. There is one grove she keeps for me.",
    ],
  },
  {
    id: "lyra",
    name: "Lyra Silentchant",
    title: "Second hour",
    color: "#3a3850",
    accent: "#d0c080",
    height: 1.68,
    x: 18,
    z: 6,
    wander: 1.4,
    lines: [
      "I have not taught a ninth Refusal because it cannot be taught. It can only be walked into.",
      "Each of the Eight, held alone, becomes its own tyranny.",
      "The Third Keeper walked into the goddess and was not seen again. Remember that before you ask for more.",
    ],
  },
  {
    id: "warden",
    name: "Arena Warden Gale",
    title: "Iron Wardens",
    color: "#6a6860",
    accent: "#c8c0a8",
    height: 1.9,
    x: 0,
    z: 32,
    wander: 0.4,
    lines: [
      "The Court forbids conquest. The sand does not.",
      "Poise, not luck. If you stagger, it is because the blow was heavier than your stance.",
      "Dodge the sweep. Parry the thrust. Don't get greedy on a heavy.",
    ],
  },
];

export const SCHEMES = [
  {
    id: "zero-nyx",
    plotter: "nyx",
    target: "zero",
    text: "Nyx is watching Zero from inside the Grid embassy. A scheme, not a stare.",
    barge: "You step between them. Nyx's jaw tightens; Zero files you as a variable he cannot count.",
  },
  {
    id: "elias-vesper",
    plotter: "elias",
    target: "vesper",
    text: "Elias and Vesper share a street, a bloodline, and an apparatus of mutual surveillance.",
    barge: "You name the bloodline out loud. Both of them look at you as if you had drawn a knife in the Court.",
  },
  {
    id: "seraphine-elias",
    plotter: "seraphine",
    target: "elias",
    text: "Lady Seraphine is compiling a courtesy that will ruin Elias without ever raising a voice.",
    barge: "You spoil the courtesy. Seraphine smiles like a closed door. Elias owes you a debt he hates.",
  },
  {
    id: "jax-mama",
    plotter: "jax",
    target: "mama",
    text: "Jax is shopping a contract that would split Mama's people across three worlds.",
    barge: "You put the contract in the lantern light. Mama does not shout. The deal dies anyway.",
  },
];

export const FACTION_TICKER = [
  "Crimson Court embassy: a debt called in as a dinner invitation.",
  "Grid embassy: the data spine hummed, then went quiet for four seconds.",
  "Frontier walkers: still no seat at the Ring. They call the road their door.",
  "Verdant Veil: pollen count up. Someone is arguing about the ninth Refusal again.",
  "Iron Wardens: the Arena posted a new rule. No live steel in the Court. As if anyone needed telling.",
  "Luminary charities posted a surplus. Anti-Sovereign leaflets appeared in the same hour.",
  "Scholars' embassy: the Voss genealogy remains sealed. Two petitioners left without speaking.",
  "Sovereign Ruins: a griffin roosted on the west arch. The keepers did not hunt it.",
  "Crime World: a delayed invoice arrived three streets late and still found someone.",
  "The Crucible: a drift-event catalogued itself, then un-catalogued the catalogue.",
  "Tunya: a well-serpent drank, then left the fruit. Harvest refused.",
  "The Sundering: the held-gaze basilisk blinked. Thorne walked on.",
];

export const OBJECTIVES = [
  { id: "lamp", label: "Speak with the Lamplighter" },
  { id: "ring", label: "Walk three doors of the Ring" },
  { id: "scheme", label: "Overhear a scheme — or barge in" },
  { id: "arena", label: "Train in the Arena (poise, not dice)" },
  { id: "gate", label: "Cross a gate. Walk a kingdom road. Come back changed." },
] as const;

export type Theme = {
  id: WorldId;
  skyTop: string;
  skyHorizon: string;
  fog: string;
  ground: string;
  sun: string;
  ambient: string;
  building: string;
  building2: string;
  lamp: string;
  fogFar: number;
  saturation: number;
  style: "stone" | "neon" | "noir" | "ruins" | "timber" | "arcology";
};

export const THEMES: Record<WorldId, Theme> = {
  "concordia-hub": {
    id: "concordia-hub",
    skyTop: "#4a94c8",
    skyHorizon: "#c5def0",
    fog: "#c8dce8",
    ground: "#6e7a40",
    sun: "#fff4d2",
    ambient: "#e8f0f8",
    building: "#8a5a48",
    building2: "#6a4a38",
    lamp: "#ffd890",
    fogFar: 280,
    saturation: 1,
    style: "stone",
  },
  "sovereign-ruins": {
    id: "sovereign-ruins",
    skyTop: "#c8b478",
    skyHorizon: "#f0d090",
    fog: "#d8c090",
    ground: "#c8b090",
    sun: "#ffc880",
    ambient: "#fff0d0",
    building: "#c8b8a0",
    building2: "#8a7050",
    lamp: "#c8a060",
    fogFar: 420,
    saturation: 0.8,
    style: "ruins",
  },
  tunya: {
    id: "tunya",
    skyTop: "#6ab4d4",
    skyHorizon: "#f5c068",
    fog: "#f0c08a",
    ground: "#c88840",
    sun: "#ffb060",
    ambient: "#fff0d0",
    building: "#a06838",
    building2: "#6a4020",
    lamp: "#ffa040",
    fogFar: 440,
    saturation: 1.05,
    style: "timber",
  },
  fantasy: {
    id: "fantasy",
    skyTop: "#4a78a8",
    skyHorizon: "#c8d8e0",
    fog: "#b8d4d0",
    ground: "#4a7a50",
    sun: "#fff0d0",
    ambient: "#c8e0e0",
    building: "#8a9a88",
    building2: "#5a6a58",
    lamp: "#ffd070",
    fogFar: 430,
    saturation: 1.12,
    style: "stone",
  },
  crime: {
    id: "crime",
    skyTop: "#1a1612",
    skyHorizon: "#4a3a28",
    fog: "#2a2018",
    ground: "#2a241c",
    sun: "#c8b890",
    ambient: "#40342a",
    building: "#3a3228",
    building2: "#1a1612",
    lamp: "#ffa030",
    fogFar: 380,
    saturation: 0.62,
    style: "noir",
  },
  cyber: {
    id: "cyber",
    skyTop: "#0a0218",
    skyHorizon: "#4a1078",
    fog: "#180830",
    ground: "#141022",
    sun: "#a080ff",
    ambient: "#3a1850",
    building: "#1a1230",
    building2: "#2a1850",
    lamp: "#30e8ff",
    fogFar: 380,
    saturation: 1.25,
    style: "neon",
  },
  "concord-link-frontier": {
    id: "concord-link-frontier",
    skyTop: "#80b8e0",
    skyHorizon: "#f0e0a8",
    fog: "#e0d0a0",
    ground: "#c8b070",
    sun: "#fff0c0",
    ambient: "#fff0d8",
    building: "#8a7048",
    building2: "#5a4830",
    lamp: "#ffc878",
    fogFar: 500,
    saturation: 0.95,
    style: "timber",
  },
  superhero: {
    id: "superhero",
    skyTop: "#60a8d8",
    skyHorizon: "#e8f0f8",
    fog: "#c0d8f0",
    ground: "#8a96a4",
    sun: "#fff8e0",
    ambient: "#e0ecff",
    building: "#d8e0ea",
    building2: "#9aa8b8",
    lamp: "#ffe0a0",
    fogFar: 460,
    saturation: 1.2,
    style: "arcology",
  },
  "lattice-crucible": {
    id: "lattice-crucible",
    skyTop: "#180838",
    skyHorizon: "#682878",
    fog: "#301850",
    ground: "#241838",
    sun: "#e0a8ff",
    ambient: "#402068",
    building: "#402060",
    building2: "#201038",
    lamp: "#a060ff",
    fogFar: 400,
    saturation: 1.15,
    style: "neon",
  },
};

export function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}
