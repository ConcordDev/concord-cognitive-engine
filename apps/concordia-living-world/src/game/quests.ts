import type { WorldId } from "./content";
import { bible, CROSS_PLOTS } from "./bible";
import { settlementsOf } from "./realms";
import { worldKit } from "./worlds";
import { mulberry32, pick, xmur3 } from "./rng";
import type { Kernel } from "./kernel";
import type { WorldSlice } from "./persist";
import { onQuestTouched } from "./cross";
import { bumpHeat } from "./politics";

export type LiveQuest = {
  id: string;
  worldId: WorldId;
  title: string;
  detail: string;
  origin: string;
  loreRef: string;
  kind: "talk" | "road" | "hunt" | "mercy" | "cross";
  targetId: string;
  done: boolean;
  consequence: string;
};

export function rollQuest(world: WorldId, day: number, heat: number): LiveQuest {
  const kit = worldKit(world);
  const b = bible(world);
  const rng = mulberry32(xmur3(`${world}:q:${day}:${Math.floor(heat * 10)}`)());
  const towns = settlementsOf(world);
  const town = towns[Math.floor(rng() * Math.max(1, towns.length))] ?? towns[0];
  const npc = kit.npcs[Math.floor(rng() * Math.max(1, kit.npcs.length))] ?? kit.npcs[0];
  const plots = CROSS_PLOTS.filter((p) => p.worlds.includes(world));
  const pool: LiveQuest[] = [];
  if (npc) {
    pool.push({
      id: `${world}-talk-${day}`,
      worldId: world,
      title: `${npc.name} has a need`,
      detail: `${npc.job}. ${b.laws[0]?.text ?? b.refusal}`,
      origin: npc.name,
      loreRef: b.lore[0]?.id ?? "LORE",
      kind: "talk",
      targetId: npc.id,
      done: false,
      consequence: "An NPC schedule shifts. Faction heat eases. A rumor walks toward another door.",
    });
  }
  if (town) {
    pool.push({
      id: `${world}-road-${day}`,
      worldId: world,
      title: `Walk the road to ${town.name}`,
      detail: `${town.purpose}. Discover it; the kingdom will remember you were there.`,
      origin: b.signatureLocation,
      loreRef: b.lore[0]?.id ?? "LORE",
      kind: "road",
      targetId: town.id,
      done: false,
      consequence: "A settlement opens as a waystone. Prices ease on that road. The holding faction notices.",
    });
  }
  pool.push({
    id: `${world}-hunt-${day}`,
    worldId: world,
    title: `Meet the ${b.signatureCreature}`,
    detail: `${b.signatureMechanic}. Do not treat it as a loot table.`,
    origin: b.thesis,
    loreRef: b.laws[0]?.id ?? "LAW",
    kind: "hunt",
    targetId: "beast",
    done: false,
    consequence: "Ecology dips. Births will answer. Memory is written. A pack moves the rim.",
  });
  if (world === "superhero" || world === "sovereign-ruins" || world === "lattice-crucible") {
    pool.push({
      id: `${world}-mercy-${day}`,
      worldId: world,
      title: "Refuse the ending",
      detail: "Put something down. Watch it stand. That is the law, not a bug.",
      origin: b.refusal,
      loreRef: b.laws[0]?.id ?? "LAW",
      kind: "mercy",
      targetId: "revive",
      done: false,
      consequence: "Unburial heat. Keepers catalogue you as a guest who understood.",
    });
  }
  if (plots.length) {
    const p = pick(rng, plots);
    pool.push({
      id: `${p.id}-${day}`,
      worldId: world,
      title: p.title,
      detail: p.text,
      origin: "cross-world",
      loreRef: p.id,
      kind: "cross",
      targetId: p.worlds.find((w) => w !== world) ?? "concordia-hub",
      done: false,
      consequence: "A rumor walks through another door. Hub guests will speak of it.",
    });
  }
  return pick(rng, pool);
}

export function finishQuest(
  q: LiveQuest,
  kernel: Kernel,
  slice: WorldSlice,
  worldId: WorldId,
  line: (s: string) => void,
): LiveQuest {
  if (q.done) return q;
  q.done = true;
  if (q.kind === "talk") {
    kernel.factionHeat = Math.max(0, kernel.factionHeat - 0.22);
    kernel.prices = Math.max(0.7, kernel.prices * 0.97);
    const fac = worldKit(worldId).npcs[0];
    if (fac) bumpHeat(fac.id, -0.08);
  } else if (q.kind === "road") {
    kernel.prices = Math.max(0.7, kernel.prices * 0.94);
    slice.reputation += 1;
    kernel.factionHeat = Math.max(0, kernel.factionHeat - 0.08);
  } else if (q.kind === "hunt") {
    kernel.ecology = Math.max(0.1, kernel.ecology - 0.1);
    slice.births += 1;
  } else if (q.kind === "mercy") {
    kernel.factionHeat = Math.min(1, kernel.factionHeat + 0.06);
    slice.reputation += 1;
  } else if (q.kind === "cross") {
    slice.reputation += 2;
  }
  onQuestTouched(q);
  line(q.consequence);
  const follow = rollQuest(worldId, kernel.day + 1, kernel.factionHeat);
  slice.quest = follow;
  return follow;
}
