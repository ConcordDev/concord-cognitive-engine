import type { WorldId } from "./content";
import { bible } from "./bible";
import { worldKit } from "./worlds";
import { mulberry32, pick, xmur3 } from "./rng";
import type { Kernel } from "./kernel";
import { settlementsOf } from "./realms";

export type WorldEventKind =
  | "migration"
  | "shortage"
  | "scheme"
  | "emergence"
  | "treaty"
  | "weather"
  | "unburial"
  | "census";

export type WorldEvent = {
  kind: WorldEventKind;
  text: string;
  ecology: number;
  heat: number;
  prices: number;
  births: number;
};

const BY_WORLD: Record<WorldId, WorldEventKind[]> = {
  "concordia-hub": ["scheme", "treaty", "weather"],
  "sovereign-ruins": ["unburial", "emergence", "migration", "scheme"],
  tunya: ["migration", "shortage", "weather", "treaty"],
  fantasy: ["emergence", "scheme", "treaty"],
  crime: ["scheme", "shortage", "census"],
  cyber: ["census", "scheme", "emergence"],
  "concord-link-frontier": ["weather", "migration", "treaty"],
  superhero: ["treaty", "scheme", "emergence"],
  "lattice-crucible": ["emergence", "weather", "unburial"],
};

export function rollEvent(world: WorldId, day: number, hour: number): WorldEvent {
  const b = bible(world);
  const title = worldKit(world).title;
  const rng = mulberry32(xmur3(`${world}:evt:${day}:${Math.floor(hour)}`)());
  const kind = pick(rng, BY_WORLD[world]);
  const town = settlementsOf(world)[0];
  switch (kind) {
    case "migration":
      return {
        kind,
        text: `${b.signatureCreature} packs shifted toward ${town?.name ?? "the rim"}. Territory moved.`,
        ecology: 0.06,
        heat: -0.04,
        prices: 0.02,
        births: 1,
      };
    case "shortage":
      return {
        kind,
        text: `${b.kingdoms[0] ?? title}: stores tightened. ${b.refusal}`,
        ecology: -0.08,
        heat: 0.1,
        prices: 0.14,
        births: 0,
      };
    case "scheme":
      return {
        kind,
        text: `A faction scheme ripened in ${b.signatureLocation}. ${b.lore[0]?.text ?? b.thesis}`,
        ecology: 0,
        heat: 0.16,
        prices: 0.04,
        births: 0,
      };
    case "emergence":
      return {
        kind,
        text: `${b.signatureEvent}. The ${b.signatureCreature} took the hour.`,
        ecology: -0.05,
        heat: 0.08,
        prices: 0,
        births: 2,
      };
    case "treaty":
      return {
        kind,
        text: `${b.kingdoms[0] ?? "A court"} offered a treaty that will not hold unless someone walks it.`,
        ecology: 0.03,
        heat: -0.18,
        prices: -0.06,
        births: 0,
      };
    case "unburial":
      return {
        kind,
        text: "An unburial. Something that had been catalogued stood up and walked the road.",
        ecology: 0.02,
        heat: 0.05,
        prices: 0,
        births: 1,
      };
    case "census":
      return {
        kind,
        text: "A census skipped four numbers. Someone went missing from a ledger, not a grave.",
        ecology: -0.02,
        heat: 0.12,
        prices: 0.05,
        births: 0,
      };
    default:
      return {
        kind: "weather",
        text: `${title}: ${b.signatureEvent}`,
        ecology: 0.01,
        heat: 0,
        prices: 0,
        births: 0,
      };
  }
}

export function applyEvent(k: Kernel, ev: WorldEvent) {
  k.ecology = Math.min(1, Math.max(0.08, k.ecology + ev.ecology));
  k.factionHeat = Math.min(1, Math.max(0, k.factionHeat + ev.heat));
  k.prices = Math.min(1.8, Math.max(0.6, k.prices + ev.prices));
  k.lastEvent = ev.text;
}

export function tickEvents(k: Kernel, world: WorldId, dt: number): WorldEvent | null {
  k.eventCd -= dt;
  if (k.eventCd > 0) return null;
  k.eventCd = 26 + (world === "concordia-hub" ? 10 : 0);
  const ev = rollEvent(world, k.day, k.hour);
  applyEvent(k, ev);
  return ev;
}
