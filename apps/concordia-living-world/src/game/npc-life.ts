import { rivalSettlement, settlementsOf } from "./realms";
import type { WorldId } from "./content";
import type { WorldNpc } from "./worlds";

export type NpcBrain = {
  homeX: number;
  homeZ: number;
  jobX: number;
  jobZ: number;
  need: WorldNpc["need"];
  faction: string;
  trust: number;
  fear: number;
};

export function scheduleTarget(
  brain: NpcBrain,
  hour: number,
  heat = 0,
): { x: number; z: number; act: string } {
  const h = ((hour % 24) + 24) % 24;
  if (h < 6 || h >= 22) return { x: brain.homeX, z: brain.homeZ, act: "sleep" };
  if (heat > 0.7 && (brain.need === "safety" || brain.need === "purpose")) {
    const rival = rivalSettlement("sovereign-ruins", brain.faction);
    if (rival) return { x: rival.x + 6, z: rival.z - 4, act: "scheme" };
  }
  if (h < 12) return { x: brain.jobX, z: brain.jobZ, act: "work" };
  if (h < 14) return { x: (brain.homeX + brain.jobX) / 2, z: (brain.homeZ + brain.jobZ) / 2, act: "eat" };
  if (h < 18) return { x: brain.jobX + 3, z: brain.jobZ - 2, act: "work" };
  if (brain.fear > 0.5) return { x: brain.homeX, z: brain.homeZ, act: "hide" };
  return { x: brain.homeX + 2, z: brain.homeZ + 2, act: "gather" };
}

export function brainFor(world: WorldId, npc: WorldNpc, index: number): NpcBrain {
  const towns = settlementsOf(world);
  const town = towns[index % Math.max(1, towns.length)];
  if (index === 0 || !town) {
    return {
      homeX: npc.x,
      homeZ: npc.z,
      jobX: npc.x + 4,
      jobZ: npc.z - 3,
      need: npc.need,
      faction: npc.title,
      trust: 0.4,
      fear: 0,
    };
  }
  return {
    homeX: town.x + 3 + (index % 3) * 2,
    homeZ: town.z - 2,
    jobX: town.x - 4,
    jobZ: town.z + 5,
    need: npc.need,
    faction: town.faction,
    trust: 0.35,
    fear: 0,
  };
}

export function autonomyTarget(
  brain: NpcBrain,
  world: WorldId,
  hour: number,
  heat: number,
): { x: number; z: number; act: string } {
  const h = ((hour % 24) + 24) % 24;
  if (heat > 0.62) {
    const rival = rivalSettlement(world, brain.faction);
    if (rival && (h >= 10 && h < 16)) {
      return { x: rival.x + 8, z: rival.z + 5, act: "politics" };
    }
  }
  return scheduleTarget(brain, hour, heat);
}
