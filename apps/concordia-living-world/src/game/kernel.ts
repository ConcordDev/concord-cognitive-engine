import type { WorldId } from "./content";
import { worldKit } from "./worlds";

export type MemoryKind =
  | "combat"
  | "kindness"
  | "discovery"
  | "death"
  | "scheme"
  | "weather"
  | "rumor"
  | "economy"
  | "ecology";

export type Memory = {
  kind: MemoryKind;
  text: string;
  worldId: WorldId;
  t: number;
  importance: number;
};

export type Kernel = {
  hour: number;
  day: number;
  weather: string;
  weatherT: number;
  rumble: number;
  memories: Memory[];
  hostility: number;
  uncounted: number;
  delayed: { at: number; dmg: number; id: string }[];
  prices: number;
  rumorAt: number;
  lastEvent: string;
  ecology: number;
  factionHeat: number;
  needPulse: number;
  eventCd: number;
  polCd: number;
};

export function makeKernel(world: WorldId): Kernel {
  const kit = worldKit(world);
  return {
    hour: 7.2,
    day: 1,
    weather: kit.weather,
    weatherT: 40,
    rumble: 0,
    memories: [
      {
        kind: "rumor",
        text: "The lanterns were already lit when you arrived.",
        worldId: "concordia-hub",
        t: 0,
        importance: 0.4,
      },
    ],
    hostility: 0,
    uncounted: 0,
    delayed: [],
    prices: 1,
    rumorAt: 9,
    lastEvent: kit.system,
    ecology: 0.7,
    factionHeat: 0.2,
    needPulse: 18,
    eventCd: 16,
    polCd: 12,
  };
}

export function remember(k: Kernel, m: Omit<Memory, "t"> & { t?: number }) {
  k.memories.unshift({ ...m, t: m.t ?? 0 });
  if (k.memories.length > 16) k.memories.length = 16;
}

export function tickKernel(k: Kernel, dt: number, world: WorldId): string | null {
  k.hour = (k.hour + dt * 0.08) % 24;
  k.weatherT -= dt;
  k.hostility = Math.max(0, k.hostility - dt * 0.35);
  k.rumble = Math.max(0, k.rumble - dt);
  k.factionHeat = Math.max(0, k.factionHeat - dt * 0.02);
  k.ecology = Math.min(1, Math.max(0.15, k.ecology + dt * 0.004));
  let evt: string | null = null;
  if (k.weatherT <= 0) {
    k.weatherT = 28 + Math.random() * 22;
    const kit = worldKit(world);
    const cycle = [kit.weather, "wind", "clear", kit.weather];
    k.weather = cycle[Math.floor(Math.random() * cycle.length)]!;
    evt = weatherLine(world, k.weather);
  }
  k.rumorAt -= dt;
  if (k.rumorAt <= 0) {
    k.rumorAt = 12 + Math.random() * 10;
    evt = rumorLine(world, k);
  }
  k.needPulse -= dt;
  if (k.needPulse <= 0) {
    k.needPulse = 16 + Math.random() * 10;
    evt = needLine(world, k);
  }
  if (k.hour < 0.05) {
    k.day += 1;
    k.prices = Math.max(0.7, Math.min(1.6, k.prices * (0.96 + Math.random() * 0.1)));
    evt = `Day ${k.day}. Markets ${k.prices > 1.1 ? "tightened" : "eased"}. The world did not wait.`;
  }
  return evt;
}

function weatherLine(world: WorldId, w: string) {
  const name = worldKit(world).title;
  if (w === "rain") return `${name}: rain. Fire weakens. Witnesses go indoors.`;
  if (w === "wind") return `${name}: wind. The road argues with anyone still wearing a dome.`;
  if (w === "ash") return `${name}: ashfall. The unburied stand a little easier.`;
  if (w === "neon") return `${name}: the Grid hummed, then skipped four numbers.`;
  if (w === "drift") return `${name}: a drift-event walked across the plaza.`;
  if (w === "dawn") return `${name}: another sunrise that refuses to finish.`;
  if (w === "grove") return `${name}: the grove went quiet, then spoke in pollen.`;
  return `${name}: weather shifted. Schedules will.`;
}

function rumorLine(world: WorldId, k: Kernel) {
  const kit = worldKit(world);
  const pool = [
    `${kit.title}: a ${kit.npcs[0]?.job ?? "keeper"} changed the hour's plan.`,
    `Faction note — prices ${k.prices > 1 ? "tightened" : "eased"} after the last fight.`,
    k.memories[0] ? `Someone retold: ${k.memories[0].text}` : kit.theNo,
    `Day ${k.day}, hour ${Math.floor(k.hour)}. The world did not wait for you.`,
    k.ecology < 0.4
      ? `${kit.title}: wildlife thinned. The food chain will answer.`
      : `${kit.title}: a pack moved through at the rim.`,
    k.factionHeat > 0.5 ? `${kit.title}: a faction scheme ripened while you walked.` : kit.theNo,
  ];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function needLine(world: WorldId, k: Kernel) {
  const kit = worldKit(world);
  const n = kit.npcs[Math.floor(Math.random() * Math.max(1, kit.npcs.length))];
  if (!n) return `${kit.title}: the plaza kept its own hours.`;
  const map: Record<WorldNpcNeed, string> = {
    hunger: `${n.name} left a fire for fruit, not for conquest.`,
    safety: `${n.name} moved the children when the weather turned.`,
    purpose: `${n.name} repeated the Refusal under their breath.`,
    wealth: `${n.name} argued a price. The market remembered.`,
    belonging: `${n.name} sat with someone who was not a guest.`,
    freedom: `${n.name} refused a fence and called it a road.`,
  };
  k.prices *= n.need === "wealth" ? 1.03 : 0.995;
  return map[n.need];
}

type WorldNpcNeed = "hunger" | "safety" | "purpose" | "wealth" | "belonging" | "freedom";

export function hourLabel(h: number) {
  const hr = Math.floor(h) % 24;
  const m = Math.floor((h % 1) * 60);
  return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
