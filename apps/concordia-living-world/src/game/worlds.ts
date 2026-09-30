import type { WorldId } from "./content";
import type { Collider } from "./layout";
import { settlementsOf, REALM_FAUNA } from "./realms";

export type { WorldId };

export type FightingStyle = {
  id: string;
  name: string;
  light: string;
  heavy: string;
  special: string;
  specialKey: string;
  power: string;
  powerKey: string;
  massMul: number;
  speedMul: number;
  poiseMul: number;
};

export type WorldNpc = {
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
  job: string;
  need: "hunger" | "safety" | "purpose" | "wealth" | "belonging" | "freedom";
};

export type BeastKind =
  | "dragon"
  | "wraith"
  | "sealie"
  | "wolf"
  | "drone"
  | "hound"
  | "construct"
  | "drift"
  | "griffin"
  | "serpent"
  | "spider"
  | "golem"
  | "harpy"
  | "basilisk"
  | "sentinel"
  | "wyrm";

export type WorldBeast = {
  id: string;
  kind: BeastKind;
  name: string;
  x: number;
  z: number;
  hostile: boolean;
  fly: boolean;
};

export type WorldKit = {
  id: WorldId;
  title: string;
  refusal: string;
  theNo: string;
  silhouette: string;
  system: string;
  style: FightingStyle;
  weather: "clear" | "dust" | "rain" | "neon" | "ash" | "wind" | "dawn" | "drift" | "grove";
  bound: number;
  spawn: { x: number; z: number; yaw: number };
  portal: { x: number; z: number };
  npcs: WorldNpc[];
  beasts: WorldBeast[];
  landmarks: { kind: string; x: number; z: number; rot?: number; s?: number }[];
  colliders: Collider[];
};

function ring(n: number, r: number, rot = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rot;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, a };
  });
}

const NO_COLLIDE = new Set([
  "banner",
  "fire",
  "floor",
  "lamp",
  "sign",
  "crystal",
  "pollen",
  "bone",
  "rain",
  "fern",
  "grave",
  "arch",
  "gate",
]);

function collidersFrom(points: { x: number; z: number; kind?: string }[], r: number): Collider[] {
  return points
    .filter((p) => !NO_COLLIDE.has(p.kind ?? ""))
    .map((p) => {
      const kind = p.kind ?? "";
      const rad =
        kind === "pillar" || kind === "statue" ? 1.15 : kind === "hut" || kind === "keep" ? 2.2 : kind === "wall" ? 0.7 : r;
      return { x: p.x, z: p.z, r: rad };
    });
}

const PROP_TABLE: Record<WorldId, string[]> = {
  "concordia-hub": ["lamp", "stall", "tree"],
  "sovereign-ruins": ["rubble", "grave", "bone", "pillar", "statue", "banner", "lamp"],
  tunya: ["tree", "hut", "shrine", "fern", "fire", "boulder"],
  fantasy: ["tree", "statue", "banner", "shrine", "crystal", "rack", "lamp"],
  crime: ["crate", "rack", "lamp", "sign", "stall", "fence"],
  cyber: ["crystal", "lamp", "sign", "dish", "crate", "tower"],
  "concord-link-frontier": ["cactus", "wagon", "tent", "fire", "boulder", "fence"],
  superhero: ["lamp", "statue", "sign", "stall", "crystal"],
  "lattice-crucible": ["shard", "crystal", "rubble", "tower", "bone"],
};

function scatter(
  id: WorldId,
  bound: number,
  spawn: { x: number; z: number },
  portal: { x: number; z: number },
) {
  const kinds = PROP_TABLE[id];
  const out: { kind: string; x: number; z: number; rot: number; s: number }[] = [];
  const n = id === "concordia-hub" ? 8 : 56;
  for (let i = 0; i < n; i++) {
    const a = i * 2.399 + 0.41;
    const r = 6 + (i % 14) * 6.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 3.2) continue;
    if (Math.hypot(x - portal.x, z - portal.z) < 3.3) continue;
    if (r > bound - 3) continue;
    out.push({
      kind: kinds[i % kinds.length]!,
      x,
      z,
      rot: a,
      s: 0.78 + (i % 5) * 0.12,
    });
  }
  for (const s of settlementsOf(id)) {
    out.push({ kind: s.kind === "keep" || s.kind === "spire" ? "tower" : "hut", x: s.x, z: s.z, rot: 0.2, s: 1.4 });
    out.push({ kind: "fire", x: s.x + 3.2, z: s.z + 1.4, rot: 0, s: 1 });
    out.push({ kind: "banner", x: s.x - 2.4, z: s.z + 2, rot: 0.4, s: 1 });
  }
  return out;
}

const FLY: Set<BeastKind> = new Set(["dragon", "griffin", "harpy", "drone", "sentinel", "wyrm", "drift"]);

function patrols(id: WorldId): WorldBeast[] {
  if (id === "concordia-hub") return [];
  const fauna = REALM_FAUNA[id];
  if (!fauna.length) return [];
  const out: WorldBeast[] = [];
  const rings = [11, 18, 28, 42];
  let n = 0;
  for (const r of rings) {
    const count = r <= 18 ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r * 0.07;
      const kind = fauna[n % fauna.length]!;
      out.push({
        id: `${id}-pat-${n}`,
        kind,
        name: kind,
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        hostile: true,
        fly: FLY.has(kind),
      });
      n++;
    }
  }
  for (const s of settlementsOf(id)) {
    const kind = fauna[n % fauna.length]!;
    out.push({
      id: `${s.id}-guard-a`,
      kind,
      name: kind,
      x: s.x + 5,
      z: s.z + 2,
      hostile: true,
      fly: FLY.has(kind),
    });
    out.push({
      id: `${s.id}-guard-b`,
      kind: fauna[(n + 1) % fauna.length]!,
      name: fauna[(n + 1) % fauna.length]!,
      x: s.x - 4,
      z: s.z - 3,
      hostile: true,
      fly: false,
    });
    n += 2;
  }
  return out;
}

const STYLES: Record<WorldId, FightingStyle> = {
  "concordia-hub": {
    id: "court",
    name: "Unarmed Court",
    light: "Palm",
    heavy: "Shoulder",
    special: "Flower-step",
    specialKey: "G",
    power: "A guest's dash. The Court still prefers open hands.",
    powerKey: "1",
    massMul: 1.35,
    speedMul: 1.08,
    poiseMul: 1.25,
  },
  "sovereign-ruins": {
    id: "keepers",
    name: "Glyph Keepers",
    light: "Ash cut",
    heavy: "Unburial",
    special: "Refuse ending",
    specialKey: "G",
    power: "Pull a fall back into standing. The unburied flinch.",
    powerKey: "1",
    massMul: 1.2,
    speedMul: 0.9,
    poiseMul: 1.35,
  },
  tunya: {
    id: "veil",
    name: "Verdant Veil",
    light: "Reed",
    heavy: "Grove-root",
    special: "Do not reap",
    specialKey: "G",
    power: "A pollen ward. Hostility settles. Take fruit, never the tree.",
    powerKey: "1",
    massMul: 1,
    speedMul: 1.05,
    poiseMul: 1.2,
  },
  fantasy: {
    id: "sundering",
    name: "Sundering Guard",
    light: "Ward-blade",
    heavy: "Curse-held",
    special: "Turn it inward",
    specialKey: "G",
    power: "Fold the overflow. Poise returns. Do not become the dragon.",
    powerKey: "1",
    massMul: 1.1,
    speedMul: 1,
    poiseMul: 1,
  },
  crime: {
    id: "ghost",
    name: "Ghost Contracts",
    light: "Switch",
    heavy: "Iron",
    special: "Delay the bill",
    specialKey: "G",
    power: "Collect every delayed debt at once. Witnesses remember.",
    powerKey: "1",
    massMul: 0.95,
    speedMul: 1.15,
    poiseMul: 0.85,
  },
  cyber: {
    id: "zero",
    name: "Uncounted",
    light: "Pulse",
    heavy: "Stack overflow",
    special: "Refuse the number",
    specialKey: "G",
    power: "Dump the uncounted as a ring. The Grid cannot file you.",
    powerKey: "1",
    massMul: 0.9,
    speedMul: 1.2,
    poiseMul: 0.9,
  },
  "concord-link-frontier": {
    id: "road",
    name: "Open Road",
    light: "Dust-kick",
    heavy: "Wagon iron",
    special: "Leave the dome",
    specialKey: "G",
    power: "Wind at your back. The fence was never architecture.",
    powerKey: "1",
    massMul: 1.05,
    speedMul: 1.25,
    poiseMul: 1,
  },
  superhero: {
    id: "dawn",
    name: "Permanent Dawn",
    light: "Fist",
    heavy: "Shockwave",
    special: "Refuse the win",
    specialKey: "G",
    power: "Mercy shock. Knock them without taking the sunrise.",
    powerKey: "1",
    massMul: 1.3,
    speedMul: 1.1,
    poiseMul: 1.4,
  },
  "lattice-crucible": {
    id: "drift",
    name: "Open Lattice",
    light: "Shard",
    heavy: "Recycle",
    special: "Refuse completion",
    specialKey: "G",
    power: "A drift-event walks through the fight. Un-end it.",
    powerKey: "1",
    massMul: 1.15,
    speedMul: 1,
    poiseMul: 1.1,
  },
};

function kit(
  partial: Omit<WorldKit, "style" | "colliders"> & { colliders?: Collider[] },
): WorldKit {
  const extra = partial.colliders ?? [];
  const scattered = scatter(partial.id, partial.bound, partial.spawn, partial.portal);
  const landmarks = [...partial.landmarks, ...scattered];
  const fromLand = collidersFrom(
    landmarks.map((l) => ({ x: l.x, z: l.z, kind: l.kind })),
    0.62,
  );
  const archCols: Collider[] = [];
  for (const l of landmarks) {
    if (l.kind !== "arch" && l.kind !== "gate") continue;
    const rot = l.rot ?? 0;
    const span = (l.kind === "gate" ? 1.85 : 1.2) * (l.s ?? 1);
    const lx = Math.cos(rot);
    const lz = -Math.sin(rot);
    archCols.push({ x: l.x + lx * span, z: l.z + lz * span, r: 0.4 });
    archCols.push({ x: l.x - lx * span, z: l.z - lz * span, r: 0.4 });
  }
  const wallCols: Collider[] = [];
  for (const l of landmarks) {
    if (l.kind !== "wall") continue;
    const rot = l.rot ?? 0;
    const len = 6.5 * (l.s ?? 1);
    const cx = Math.cos(rot);
    const sz = Math.sin(rot);
    for (let t = -len / 2; t <= len / 2; t += 1.5) {
      if (l.z > 6 && Math.abs(t) < 1.9) continue;
      wallCols.push({ x: l.x + cx * t, z: l.z + sz * t, r: 0.55 });
    }
  }
  return {
    ...partial,
    beasts: [...partial.beasts, ...patrols(partial.id)],
    landmarks,
    style: STYLES[partial.id],
    colliders: [...fromLand, ...archCols, ...wallCols, ...extra, ...settlementsOf(partial.id).flatMap((s) => [
      { x: s.x, z: s.z, r: 2.5 },
      { x: s.x + 4.2, z: s.z + 1.2, r: 1.7 },
      { x: s.x - 3.6, z: s.z - 1.4, r: 1.5 },
    ])],
  };
}

export const WORLD_KITS: Record<WorldId, WorldKit> = {
  "concordia-hub": kit({
    id: "concordia-hub",
    title: "The Unburned Court",
    refusal: "Concordant Law",
    theNo: "You cannot own the heart.",
    silhouette: "Ring of eight doors around a living plaza",
    system: "Social / politics. Blades die as flowers except in the Arena.",
    weather: "clear",
    bound: 48,
    spawn: { x: 26, z: 0, yaw: Math.PI / 2 },
    portal: { x: 0, z: 0 },
    npcs: [],
    beasts: [],
    landmarks: [],
  }),

  "sovereign-ruins": kit({
    id: "sovereign-ruins",
    title: "Sovereign Ruins",
    refusal: "Refusal of Death",
    theNo: "We will not allow our ending to be final.",
    silhouette: "Broken arches, damaged pillars, unburied statues",
    system: "Undead. Wraiths you put down stand back up. Archaeology, not conquest.",
    weather: "ash",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "keeper-ash",
        name: "Ash-Scribe Helene",
        title: "Glyph keeper",
        color: "#c8b8a0",
        accent: "#c8a060",
        height: 1.7,
        x: -4,
        z: -2,
        wander: 1.2,
        job: "catalogue the still-dying",
        need: "purpose",
        lines: [
          "Nothing here has finished. That is the point and the wound.",
          "If you knock a wraith down, wait. It will remember how to stand.",
          "The Court Unburned in the hub is this same act, attempted smaller.",
        ],
      },
      {
        id: "keeper-bone",
        name: "Ossuary Vell",
        title: "Bone choir",
        color: "#a89880",
        accent: "#e8d8b0",
        height: 1.62,
        x: 5,
        z: -6,
        wander: 0.9,
        job: "keep the names of the unburied",
        need: "belonging",
        lines: [
          "The griffin still roosts on the west arch. We do not hunt it. Hunting is an ending.",
          "Ash is just stone that refused to stay a building.",
          "G, here, is refuse-ending. 1 is unburial. Learn the difference with your hands.",
        ],
      },
    ],
    beasts: [
      { id: "wraith-1", kind: "wraith", name: "Unburied", x: 6, z: 4, hostile: true, fly: false },
      { id: "wraith-2", kind: "wraith", name: "Unburied", x: -6, z: 3, hostile: true, fly: false },
      { id: "wraith-3", kind: "wraith", name: "Unburied", x: 4, z: -8, hostile: true, fly: false },
      { id: "ruin-drake", kind: "dragon", name: "Ash-Drake", x: 0, z: -10, hostile: true, fly: true },
      { id: "ruin-griff", kind: "griffin", name: "Arch-griffin", x: 9, z: -4, hostile: true, fly: true },
      { id: "ruin-spider", kind: "spider", name: "Crypt spinner", x: -8, z: 8, hostile: true, fly: false },
    ],
    landmarks: [
      ...ring(8, 11).map((p) => ({ kind: "arch", x: p.x, z: p.z, rot: p.a })),
      { kind: "pillar", x: -7, z: -2 },
      { kind: "pillar", x: 7, z: -2 },
      { kind: "pillar", x: -7, z: 2 },
      { kind: "pillar", x: 7, z: 2 },
      { kind: "statue", x: -3, z: -3 },
      { kind: "statue", x: 3, z: -3 },
      { kind: "statue", x: 3, z: 3 },
      { kind: "statue", x: -3, z: 3 },
      { kind: "banner", x: -2, z: -5 },
      { kind: "banner", x: 2, z: -5 },
      { kind: "banner", x: 5, z: -2 },
      { kind: "banner", x: 5, z: 2 },
      { kind: "banner", x: 2, z: 5 },
      { kind: "banner", x: -2, z: 5 },
      { kind: "grave", x: -5, z: 8 },
      { kind: "grave", x: 5, z: 8 },
      ...Array.from({ length: 36 }, (_, i) => {
        const a = i * 2.399 + 0.61;
        const r = 36 + (i % 8) * 22;
        const kinds = ["arch", "pillar", "statue", "rubble", "column", "grave"] as const;
        return { kind: kinds[i % kinds.length]!, x: Math.cos(a) * r, z: Math.sin(a) * r, rot: a + Math.PI / 2, s: 0.9 + (i % 4) * 0.12 };
      }),
    ],
  }),

  tunya: kit({
    id: "tunya",
    title: "Tunya",
    refusal: "Refusal of Harvest",
    theNo: "We will not be reaped.",
    silhouette: "Grove-ring, mesas, harvest fires that are never fully taken",
    system: "Ecology. Groves restore poise if you do not reap. Sealies patrol the rim.",
    weather: "grove",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "veil-keeper",
        name: "Grove-Keeper Iyatte",
        title: "Verdant Veil",
        color: "#a06838",
        accent: "#ffa040",
        height: 1.68,
        x: 2,
        z: -4,
        wander: 1.6,
        job: "negotiate with soil",
        need: "belonging",
        lines: [
          "The Eight Refusals were written here. We are the spine's birthplace.",
          "Take fruit if you must. Do not take the tree. That is how we fled Earth.",
          "The Second Drought was the soil refusing back. Listen when the grove goes quiet.",
        ],
      },
      {
        id: "veil-hand",
        name: "Mesa-Hand Sola",
        title: "Soil speaker",
        color: "#8a5828",
        accent: "#d8c070",
        height: 1.58,
        x: -6,
        z: 4,
        wander: 1.8,
        job: "walk the harvest fires",
        need: "hunger",
        lines: [
          "Sealies keep the rim. Wolves keep the gullies. Serpents keep the wells. We keep the refusal.",
          "Stand in the inner grove and your poise comes back. That is not magic. That is the soil.",
          "G is do-not-reap. It heals. 1 is pollen-ward. Hostility is a kind of harvest too.",
        ],
      },
    ],
    beasts: [
      { id: "sealie-1", kind: "sealie", name: "Sealie", x: 10, z: 8, hostile: true, fly: false },
      { id: "sealie-2", kind: "sealie", name: "Sealie", x: -9, z: 6, hostile: true, fly: false },
      { id: "wolf-t", kind: "wolf", name: "Dust-wolf", x: -8, z: -8, hostile: true, fly: false },
      { id: "wolf-t2", kind: "wolf", name: "Dust-wolf", x: 8, z: -9, hostile: true, fly: false },
      { id: "serp-t", kind: "serpent", name: "Desert snake", x: 0, z: -11, hostile: true, fly: false },
    ],
    landmarks: [
      ...ring(8, 14).map((p) => ({ kind: "tree", x: p.x, z: p.z, s: 1.2 })),
      { kind: "mesa", x: -10, z: 0, s: 1.4 },
      { kind: "mesa", x: 10, z: 0, s: 1.4 },
      { kind: "mesa", x: 0, z: -10, s: 1.3 },
      { kind: "mesa", x: 0, z: 10, s: 1.3 },
      { kind: "mesa", x: -7, z: -7, s: 1 },
      { kind: "mesa", x: 7, z: 7, s: 1 },
      { kind: "fire", x: -3, z: -3 },
      { kind: "fire", x: 3, z: -3 },
      { kind: "fire", x: 3, z: 3 },
      { kind: "fire", x: -3, z: 3 },
      { kind: "statue", x: -5, z: -5 },
      { kind: "statue", x: 5, z: -5 },
      { kind: "statue", x: 5, z: 5 },
      { kind: "statue", x: -5, z: 5 },
      { kind: "hut", x: -12, z: 4 },
      { kind: "shrine", x: 4, z: -6 },
    ],
  }),

  fantasy: kit({
    id: "fantasy",
    title: "The Sundering",
    refusal: "Refusal of Hostility",
    theNo: "I will not become the thing destroying me.",
    silhouette: "Grove-court, banners, a dragon that will not be finished",
    system: "Melee + held curse. Hostility you feed turns inward. Dragons remember.",
    weather: "clear",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "thorne-field",
        name: "Thorne Blackroot",
        title: "The held curse",
        color: "#1a3028",
        accent: "#60ffc0",
        height: 1.96,
        x: -4,
        z: 6,
        wander: 0.8,
        job: "refuse to win with it",
        need: "purpose",
        lines: [
          "I could end the dragon. I would become it. So I walk the grove instead.",
          "If your hostility climbs, the curse will take your own poise. That is the lesson.",
          "The forests go quiet around me because restraint, held long enough, looks like defeat.",
        ],
      },
      {
        id: "sunder-page",
        name: "Page Oren",
        title: "Grove squire",
        color: "#4a6848",
        accent: "#c8e0b0",
        height: 1.64,
        x: 6,
        z: -2,
        wander: 1.4,
        job: "keep the banners from becoming flags of war",
        need: "purpose",
        lines: [
          "The basilisk stares. Dodge it. Do not parry a stare — that is how people freeze.",
          "Griffin on the north wall is older than the Sundering. It has opinions about guests.",
          "His special turns the curse inward. Yours will too, if you feed it.",
        ],
      },
    ],
    beasts: [
      { id: "sunder-drake", kind: "dragon", name: "Sundering Drake", x: 0, z: -8, hostile: true, fly: true },
      { id: "wolf-f1", kind: "wolf", name: "Grove wolf", x: 7, z: 4, hostile: true, fly: false },
      { id: "wolf-f2", kind: "wolf", name: "Grove wolf", x: -7, z: 3, hostile: true, fly: false },
      { id: "basil-f", kind: "basilisk", name: "Held-gaze", x: 8, z: -6, hostile: true, fly: false },
      { id: "griff-f", kind: "griffin", name: "Wall-griffin", x: -9, z: -5, hostile: true, fly: true },
    ],
    landmarks: [
      ...ring(8, 8).map((p) => ({ kind: "tree", x: p.x, z: p.z, s: 1.1 })),
      { kind: "wall", x: 0, z: -10, rot: 0, s: 1.4 },
      { kind: "wall", x: 0, z: 10, rot: Math.PI, s: 1.4 },
      { kind: "wall", x: 10, z: 0, rot: Math.PI / 2, s: 1.4 },
      { kind: "wall", x: -10, z: 0, rot: -Math.PI / 2, s: 1.4 },
      { kind: "arch", x: 8, z: -8 },
      { kind: "arch", x: 8, z: 8 },
      { kind: "arch", x: -8, z: 8 },
      { kind: "arch", x: -8, z: -8 },
      { kind: "gate", x: 0, z: 12, rot: Math.PI },
      { kind: "column", x: 0, z: -3 },
      { kind: "column", x: 3, z: 0 },
      { kind: "column", x: 0, z: 3 },
      { kind: "column", x: -3, z: 0 },
      { kind: "statue", x: 5, z: -5 },
      { kind: "statue", x: -5, z: 5 },
      { kind: "rack", x: 3, z: 11 },
      { kind: "banner", x: -4, z: 8 },
      { kind: "banner", x: 4, z: 8 },
    ],
  }),

  crime: kit({
    id: "crime",
    title: "Crime World",
    refusal: "Refusal of Consequence",
    theNo: "What we do will not catch up to us.",
    silhouette: "Walled yard, weapon racks, a south gate that never holds anyone",
    system: "Crime/law. Hits land late. Witnesses decide. The bill always arrives.",
    weather: "rain",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "mama-yard",
        name: "Mama Iron Rose",
        title: "Delgado yard",
        color: "#5c3038",
        accent: "#e0a0a8",
        height: 1.62,
        x: -5,
        z: -2,
        wander: 1,
        job: "keep people across worlds",
        need: "safety",
        lines: [
          "You can throw the punch now. The world will invoice you in a breath.",
          "I do not sleep in the same world twice. That is how I keep my people.",
          "Cops here are a weather system. Don't confuse them with justice.",
        ],
      },
      {
        id: "yard-jax",
        name: "Jax Rivera",
        title: "On a contract",
        color: "#2a241c",
        accent: "#c4a070",
        height: 1.8,
        x: 6,
        z: 3,
        wander: 2.2,
        job: "shop a split that will not hold",
        need: "wealth",
        lines: [
          "Hounds first. Construct second. The bill third. That's the order, not a suggestion.",
          "G delays the hit. 1 collects. I have used both on people I liked.",
          "If something follows you home, that's not my problem. That's the point.",
        ],
      },
    ],
    beasts: [
      { id: "hound-1", kind: "hound", name: "Yard hound", x: 5, z: 4, hostile: true, fly: false },
      { id: "hound-2", kind: "hound", name: "Yard hound", x: -6, z: 5, hostile: true, fly: false },
      { id: "hound-3", kind: "hound", name: "Walker hound", x: 7, z: -5, hostile: true, fly: false },
      { id: "construct-cop", kind: "construct", name: "Beat construct", x: 0, z: -8, hostile: true, fly: false },
      { id: "crime-spider", kind: "spider", name: "Alley spinner", x: -8, z: -6, hostile: true, fly: false },
    ],
    landmarks: [
      { kind: "wall", x: 0, z: -10, s: 1.5 },
      { kind: "wall", x: 10, z: 0, rot: Math.PI / 2, s: 1.5 },
      { kind: "wall", x: 0, z: 10, rot: Math.PI, s: 1.5 },
      { kind: "wall", x: -10, z: 0, rot: -Math.PI / 2, s: 1.5 },
      { kind: "arch", x: 8, z: -8 },
      { kind: "arch", x: 8, z: 8 },
      { kind: "arch", x: -8, z: 8 },
      { kind: "arch", x: -8, z: -8 },
      { kind: "gate", x: 0, z: 12, rot: Math.PI },
      { kind: "column", x: 0, z: -5 },
      { kind: "column", x: 5, z: 0 },
      { kind: "column", x: 0, z: 5 },
      { kind: "column", x: -5, z: 0 },
      { kind: "rack", x: -8, z: -2 },
      { kind: "rack", x: 8, z: -2 },
      { kind: "rack", x: 8, z: 2 },
      { kind: "rack", x: -8, z: 2 },
      { kind: "crate", x: -3, z: -3 },
      { kind: "crate", x: 3, z: -3 },
      { kind: "crate", x: 3, z: 3 },
      { kind: "crate", x: -3, z: 3 },
      { kind: "crate", x: 3, z: 6 },
      { kind: "crate", x: -3, z: 7 },
      { kind: "sign", x: 0, z: -6 },
    ],
  }),

  cyber: kit({
    id: "cyber",
    title: "The Grid",
    refusal: "Refusal of Numbers",
    theNo: "I will not be counted.",
    silhouette: "Hex of server towers, neon walls, uncounted damage",
    system: "Hacking / surveillance. Combos refuse to number until you let them.",
    weather: "neon",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "nyx-grid",
        name: "Nyx Torres",
        title: "Blackout",
        color: "#12121a",
        accent: "#30e8ff",
        height: 1.7,
        x: -3,
        z: -4,
        wander: 1.4,
        job: "organize the uncounted",
        need: "freedom",
        lines: [
          "He counts. I organize the people the Grid will not number.",
          "Your damage here will not display until the combo breaks. That's the joke.",
          "Zero uploaded a city so he would not have to be one number. File that.",
        ],
      },
      {
        id: "grid-zero",
        name: "Kael Nakamura",
        title: "Zero",
        color: "#1a1028",
        accent: "#ff2bd5",
        height: 1.86,
        x: 4,
        z: 5,
        wander: 1,
        job: "study the gap that cannot be counted",
        need: "purpose",
        lines: [
          "Sentinels beam. Parry the thrust. Drones census. Refuse the number.",
          "G hides the damage. 1 flushes it as a ring. I built that joke into the plaza.",
          "I no longer know which clone is original. I have refused the number that would tell me.",
        ],
      },
    ],
    beasts: [
      { id: "drone-1", kind: "drone", name: "Census drone", x: 5, z: -3, hostile: true, fly: true },
      { id: "drone-2", kind: "drone", name: "Census drone", x: -5, z: 3, hostile: true, fly: true },
      { id: "drone-3", kind: "drone", name: "Census drone", x: 2, z: 7, hostile: true, fly: true },
      { id: "drone-4", kind: "drone", name: "Census drone", x: -7, z: -6, hostile: true, fly: true },
      { id: "sent-1", kind: "sentinel", name: "Beam sentinel", x: 0, z: -9, hostile: true, fly: true },
    ],
    landmarks: [
      { kind: "tower", x: 0, z: -6, s: 2.2 },
      { kind: "tower", x: 5.2, z: -3, s: 2 },
      { kind: "tower", x: 5.2, z: 3, s: 2.4 },
      { kind: "tower", x: 0, z: 6, s: 2 },
      { kind: "tower", x: -5.2, z: 3, s: 2.1 },
      { kind: "tower", x: -5.2, z: -3, s: 1.9 },
      { kind: "wall", x: 0, z: -10, s: 1.3 },
      { kind: "wall", x: 10, z: 0, rot: Math.PI / 2, s: 1.3 },
      { kind: "wall", x: 0, z: 10, rot: Math.PI, s: 1.3 },
      { kind: "wall", x: -10, z: 0, rot: -Math.PI / 2, s: 1.3 },
      { kind: "arch", x: 8, z: -8 },
      { kind: "arch", x: 8, z: 8 },
      { kind: "arch", x: -8, z: 8 },
      { kind: "arch", x: -8, z: -8 },
      { kind: "dish", x: 8, z: 8 },
      { kind: "dish", x: -8, z: -8 },
      { kind: "sign", x: 3, z: 0 },
    ],
  }),

  "concord-link-frontier": kit({
    id: "concord-link-frontier",
    title: "The Frontier",
    refusal: "Refusal of the Dome",
    theNo: "The road is our door.",
    silhouette: "Open scrub, wagons, no outer wall — wind is the architecture",
    system: "Survival / exploration. Sprint lives here. Wildlife, not fences.",
    weather: "wind",
    bound: 1700,
    spawn: { x: 0, z: 18, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "ren-road",
        name: "Captain Ren Solare",
        title: "Road walker",
        color: "#8a7048",
        accent: "#ffc878",
        height: 1.8,
        x: 4,
        z: -3,
        wander: 2.4,
        job: "keep the road a door",
        need: "freedom",
        lines: [
          "They still have no seat at the Ring. Fine. The road is the door.",
          "If you came from a dome, drop it. Wind will do the rest.",
          "Wagons remember every settlement that tried to close itself.",
        ],
      },
      {
        id: "frontier-hand",
        name: "Settler Brann",
        title: "Wagon family",
        color: "#6a5030",
        accent: "#e0c090",
        height: 1.72,
        x: -6,
        z: 5,
        wander: 2.8,
        job: "keep a fire that is a door, not a fence",
        need: "safety",
        lines: [
          "Wolves work in threes. Harpies work in weather. Don't stand still for either.",
          "Shift sprints harder here. G is leave-the-dome. 1 is the wind taking your back.",
          "We will not be a district of someone else's plaza.",
        ],
      },
    ],
    beasts: [
      { id: "wolf-fr1", kind: "wolf", name: "Scrub wolf", x: 12, z: 6, hostile: true, fly: false },
      { id: "wolf-fr2", kind: "wolf", name: "Scrub wolf", x: -11, z: 8, hostile: true, fly: false },
      { id: "wolf-fr3", kind: "wolf", name: "Scrub wolf", x: 8, z: -10, hostile: true, fly: false },
      { id: "wolf-fr4", kind: "wolf", name: "Dust jackal", x: -14, z: -4, hostile: true, fly: false },
      { id: "harpy-fr", kind: "harpy", name: "Cliff condor", x: 0, z: -14, hostile: true, fly: true },
      { id: "harpy-fr2", kind: "harpy", name: "Trail falcon", x: 16, z: 2, hostile: true, fly: true },
    ],
    landmarks: [
      { kind: "wagon", x: -8, z: 2, rot: 0.4, s: 1.4 },
      { kind: "wagon", x: 9, z: -4, rot: -0.6, s: 1.3 },
      { kind: "cactus", x: 6, z: 8, s: 1.2 },
      { kind: "cactus", x: -10, z: -6, s: 1.4 },
      { kind: "cactus", x: 14, z: -2, s: 1 },
      { kind: "cactus", x: -4, z: 12, s: 1.3 },
      { kind: "mesa", x: -14, z: -8, s: 1.8 },
      { kind: "mesa", x: 16, z: 10, s: 1.6 },
      { kind: "fire", x: 4, z: 4 },
      { kind: "fire", x: -4, z: 4 },
      { kind: "fire", x: 4, z: -4 },
      { kind: "fire", x: -4, z: -4 },
      { kind: "banner", x: 6, z: 0 },
      { kind: "banner", x: -6, z: 0 },
      { kind: "banner", x: 0, z: 6 },
      { kind: "banner", x: 0, z: -6 },
      { kind: "gate", x: 0, z: 12, rot: Math.PI },
      { kind: "tent", x: -5, z: -2 },
      { kind: "tent", x: 6, z: 4 },
    ],
  }),

  superhero: kit({
    id: "superhero",
    title: "The Permanent Dawn",
    refusal: "Refusal of the Win",
    theNo: "I will not take the final victory.",
    silhouette: "Arcology slabs, a dawn that never finishes rising",
    system: "Powers / civilians. Knockdowns do not end. Mercy is the special.",
    weather: "dawn",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "elias-dawn",
        name: "Elias Voss",
        title: "The Enforcer",
        color: "#3d4a62",
        accent: "#c8d4e8",
        height: 1.84,
        x: -6,
        z: 2,
        wander: 1.5,
        job: "fight up from the bottom",
        need: "purpose",
        lines: [
          "If I win this sunrise, I become the Luminary. So I don't.",
          "Vesper funds the charities that keep people too comfortable to ask.",
          "Put a construct down. It will stand. That is the Refusal, not a bug.",
        ],
      },
      {
        id: "dawn-vesper",
        name: "Vesper Kane",
        title: "Luminary",
        color: "#e8e4dc",
        accent: "#a860ff",
        height: 1.78,
        x: 7,
        z: -3,
        wander: 1.3,
        job: "keep half a city fed",
        need: "wealth",
        lines: [
          "I keep half this city fed. The other half I keep honest.",
          "Harpies nest on the east slab. Sentinels watch the west. Neither is a costume.",
          "G is refuse-the-win. 1 is mercy-shock. Both leave them standing. That is the point.",
        ],
      },
    ],
    beasts: [
      { id: "hero-1", kind: "construct", name: "Dawn construct", x: 6, z: 4, hostile: true, fly: false },
      { id: "hero-2", kind: "construct", name: "Dawn construct", x: -5, z: 6, hostile: true, fly: false },
      { id: "hero-drone", kind: "drone", name: "Skywatch", x: 0, z: -8, hostile: true, fly: true },
      { id: "hero-harp", kind: "harpy", name: "Slab-harpy", x: 10, z: -6, hostile: true, fly: true },
      { id: "hero-sent", kind: "sentinel", name: "Dawn sentinel", x: -10, z: -4, hostile: true, fly: true },
    ],
    landmarks: [
      { kind: "tower", x: -6, z: -6, s: 3.4 },
      { kind: "tower", x: 6, z: -6, s: 2.8 },
      { kind: "tower", x: 6, z: 6, s: 3.1 },
      { kind: "tower", x: -6, z: 6, s: 2.6 },
      { kind: "pillar", x: 8, z: 0, s: 1.2 },
      { kind: "pillar", x: -8, z: 0, s: 1.2 },
      { kind: "pillar", x: 0, z: -8, s: 1.2 },
      { kind: "pillar", x: 0, z: 8, s: 1.2 },
      { kind: "column", x: 4, z: 0, s: 1.2 },
      { kind: "column", x: -4, z: 0, s: 1.2 },
      { kind: "column", x: 0, z: 4, s: 1.2 },
      { kind: "column", x: 0, z: -4, s: 1.2 },
      { kind: "statue", x: -3, z: -3, s: 1.2 },
      { kind: "statue", x: 3, z: -3, s: 1.2 },
      { kind: "statue", x: 3, z: 3, s: 1.2 },
      { kind: "statue", x: -3, z: 3, s: 1.2 },
      { kind: "stall", x: 5, z: 10 },
      { kind: "lamp", x: 2, z: 2 },
      { kind: "lamp", x: -2, z: 2 },
    ],
  }),

  "lattice-crucible": kit({
    id: "lattice-crucible",
    title: "The Crucible",
    refusal: "The Eighth Refusal",
    theNo: "A thing that refuses completion cannot be written down.",
    silhouette: "Floating shards, a dragon made of unfinished weather",
    system: "Simulation. Terrain drifts. Nothing is allowed to finish, including you.",
    weather: "drift",
    bound: 1700,
    spawn: { x: 0, z: 16, yaw: Math.PI },
    portal: { x: 0, z: 0 },
    npcs: [
      {
        id: "lyra-crucible",
        name: "Lyra Silentchant",
        title: "Second hour",
        color: "#3a3850",
        accent: "#d0c080",
        height: 1.68,
        x: 3,
        z: -3,
        wander: 0.9,
        job: "keep the door open",
        need: "purpose",
        lines: [
          "I will not teach a ninth. There is no ninth. There is the open door.",
          "Drift is not flavor. It is the federation noticing itself as terrain.",
          "If a fight here ends cleanly, the lattice will un-end it. Stay unfinished.",
        ],
      },
      {
        id: "crucible-hand",
        name: "Lattice-Hand Ori",
        title: "Unfinished scholar",
        color: "#2a2040",
        accent: "#a060ff",
        height: 1.74,
        x: -5,
        z: 4,
        wander: 1.1,
        job: "catalogue drift-events that will not stay catalogued",
        need: "purpose",
        lines: [
          "The wyrm is a dragon that refused to finish being a dragon. Treat it as weather.",
          "Golems stomp. They have hyperarmor. Wait the recovery. The lattice hates clean wins.",
          "G refuses completion. 1 un-ends. If you wanted a ninth art, you came to the wrong hour.",
        ],
      },
    ],
    beasts: [
      { id: "drift-1", kind: "drift", name: "Drift-event", x: 6, z: 5, hostile: true, fly: true },
      { id: "drift-2", kind: "drift", name: "Drift-event", x: -6, z: 4, hostile: true, fly: true },
      { id: "crucible-drake", kind: "dragon", name: "Lattice Drake", x: 0, z: -9, hostile: true, fly: true },
      { id: "crucible-wyrm", kind: "wyrm", name: "Unfinished wyrm", x: 8, z: -4, hostile: true, fly: true },
      { id: "crucible-golem", kind: "golem", name: "Shard golem", x: -8, z: -6, hostile: true, fly: false },
    ],
    landmarks: [
      { kind: "crystal", x: 7, z: 0, s: 1.4 },
      { kind: "crystal", x: 3.5, z: 6.06, s: 1.3 },
      { kind: "crystal", x: -3.5, z: 6.06, s: 1.2 },
      { kind: "crystal", x: -7, z: 0, s: 1.5 },
      { kind: "crystal", x: -3.5, z: -6.06, s: 1.3 },
      { kind: "crystal", x: 3.5, z: -6.06, s: 1.2 },
      { kind: "shard", x: -4, z: -4, s: 1.4 },
      { kind: "shard", x: 4, z: -4, s: 1.8 },
      { kind: "shard", x: 4, z: 4, s: 1.2 },
      { kind: "shard", x: -4, z: 4, s: 1.6 },
      { kind: "wall", x: 0, z: -10, s: 1.1 },
      { kind: "wall", x: 10, z: 0, rot: Math.PI / 2, s: 1.1 },
      { kind: "wall", x: 0, z: 10, rot: Math.PI, s: 1.1 },
      { kind: "wall", x: -10, z: 0, rot: -Math.PI / 2, s: 1.1 },
      { kind: "column", x: 3, z: 0, s: 0.8 },
      { kind: "column", x: 0, z: 3, s: 0.8 },
      { kind: "column", x: -3, z: 0, s: 0.8 },
      { kind: "column", x: 0, z: -3, s: 0.8 },
    ],
  }),
};

export function worldKit(id: WorldId): WorldKit {
  return WORLD_KITS[id];
}

export function findSpeaker(id: string) {
  for (const kit of Object.values(WORLD_KITS)) {
    const n = kit.npcs.find((x) => x.id === id);
    if (n) return n;
  }
  for (const world of WORLD_ORDER) {
    const n = settlementNpcs(world).find((x) => x.id === id);
    if (n) return n;
  }
  return null;
}

export function settlementNpcs(world: WorldId): WorldNpc[] {
  return settlementsOf(world).flatMap((s, i) => {
    const needs = ["purpose", "safety", "belonging", "hunger", "wealth", "freedom"] as const;
    return [
      {
        id: `keep-${s.id}`,
        name: i % 2 ? `Warden of ${s.name}` : `Speaker of ${s.name}`,
        title: s.faction,
        color: i % 2 ? "#6a5a48" : "#4a6070",
        accent: "#e8d8b0",
        height: 1.68 + (i % 3) * 0.06,
        x: s.x + 6,
        z: s.z + 4,
        wander: 2.4,
        job: s.purpose,
        need: needs[i % needs.length]!,
        lines: [
          `${s.name} is not a backdrop. ${s.purpose}.`,
          "Walk the road. Discover us. Then the waystone will remember your feet.",
          "We keep hours whether a guest is looking or not.",
        ],
      },
      {
        id: `hand-${s.id}`,
        name: i % 2 ? `Hand of ${s.name}` : `Keeper at ${s.name}`,
        title: s.faction,
        color: i % 2 ? "#4a3a30" : "#3a5048",
        accent: "#c8b890",
        height: 1.6,
        x: s.x - 5,
        z: s.z + 3,
        wander: 3.1,
        job: "live the hour the kingdom actually has",
        need: needs[(i + 2) % needs.length]!,
        lines: [
          `I work ${s.name}. ${s.purpose}.`,
          "If the holding faction changes, I still eat. Politics is weather with names.",
          "Ask the Speaker if you want a speech. I have a schedule.",
        ],
      },
    ];
  });
}

export const WORLD_ORDER: WorldId[] = [
  "concordia-hub",
  "sovereign-ruins",
  "tunya",
  "fantasy",
  "crime",
  "cyber",
  "concord-link-frontier",
  "superhero",
  "lattice-crucible",
];
