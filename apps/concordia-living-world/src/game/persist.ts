import type { WorldId } from "./content";
import type { LiveQuest } from "./quests";
import type { Kernel } from "./kernel";
import { defaultOwners } from "./realms";

export type WorldSlice = {
  ecology: number;
  factionHeat: number;
  prices: number;
  day: number;
  hour: number;
  discovered: string[];
  dead: string[];
  births: number;
  quest: LiveQuest | null;
  reputation: number;
  savedAt: number;
  owners: Record<string, string>;
  event: string;
};

export type LivingSave = {
  v: 1;
  slices: Partial<Record<WorldId, WorldSlice>>;
  cross: string[];
  plots: Record<string, number>;
  factions: Record<string, number>;
  travelers: string[];
};

const KEY = "concordia-living-v1";

export function emptySlice(k: Kernel, world?: WorldId): WorldSlice {
  return {
    ecology: k.ecology,
    factionHeat: k.factionHeat,
    prices: k.prices,
    day: k.day,
    hour: k.hour,
    discovered: [],
    dead: [],
    births: 0,
    quest: null,
    reputation: 0,
    savedAt: Date.now(),
    owners: world ? defaultOwners(world) : {},
    event: k.lastEvent,
  };
}

export function loadLiving(): LivingSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { v: 1, slices: {}, cross: [], plots: {}, factions: {}, travelers: [] };
    const p = JSON.parse(raw) as Partial<LivingSave>;
    if (p?.v !== 1) return { v: 1, slices: {}, cross: [], plots: {}, factions: {}, travelers: [] };
    return {
      v: 1,
      slices: p.slices ?? {},
      cross: p.cross ?? [],
      plots: p.plots ?? {},
      factions: p.factions ?? {},
      travelers: p.travelers ?? [],
    };
  } catch {
    return { v: 1, slices: {}, cross: [], plots: {}, factions: {}, travelers: [] };
  }
}

export function saveLiving(s: LivingSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function readSlice(id: WorldId): WorldSlice | null {
  const s = loadLiving().slices[id];
  if (!s) return null;
  return {
    ecology: s.ecology,
    factionHeat: s.factionHeat,
    prices: s.prices,
    day: s.day,
    hour: s.hour,
    discovered: s.discovered ?? [],
    dead: s.dead ?? [],
    births: s.births ?? 0,
    quest: s.quest ?? null,
    reputation: s.reputation ?? 0,
    savedAt: s.savedAt ?? Date.now(),
    owners: s.owners && Object.keys(s.owners).length ? s.owners : defaultOwners(id),
    event: s.event ?? "",
  };
}

export function writeSlice(id: WorldId, slice: WorldSlice) {
  const all = loadLiving();
  all.slices[id] = { ...slice, savedAt: Date.now() };
  saveLiving(all);
}

export function markCross(plotId: string) {
  const all = loadLiving();
  if (!all.cross.includes(plotId)) all.cross.push(plotId);
  saveLiving(all);
}

export function awayHours(slice: WorldSlice): number {
  const ms = Date.now() - (slice.savedAt || Date.now());
  return Math.min(18, ms / 60000);
}
