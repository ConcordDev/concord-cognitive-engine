import type { WorldId } from "./content";
import { FACTIONS, bible } from "./bible";
import { worldKit } from "./worlds";
import { settlementsOf, type Settlement } from "./realms";
import { mulberry32, pick, xmur3 } from "./rng";
import type { Kernel } from "./kernel";
import { loadLiving, saveLiving } from "./persist";

export function factionsOf(world: WorldId) {
  return FACTIONS.filter((f) => f.worldId === world || f.worldId === "cross");
}

export function heatOf(id: string): number {
  return loadLiving().factions[id] ?? 0.2;
}

export function setHeat(id: string, v: number) {
  const all = loadLiving();
  all.factions[id] = Math.max(0, Math.min(1, v));
  saveLiving(all);
}

export function bumpHeat(id: string, d: number) {
  setHeat(id, heatOf(id) + d);
}

export function seizeSettlement(settlementId: string, factionId: string, world: WorldId) {
  const all = loadLiving();
  const slice = all.slices[world];
  if (!slice) return;
  slice.owners = { ...slice.owners, [settlementId]: factionId };
  saveLiving(all);
}

export function politicsLine(world: WorldId, owners: Record<string, string> | undefined, heat: number): string {
  const towns = settlementsOf(world);
  if (!towns.length) {
    return heat > 0.5 ? "The Ring is arguing with itself." : "The Court keeps its own hours.";
  }
  const s = towns[0]!;
  const hold = owners?.[s.id] ?? s.faction;
  const fac = FACTIONS.find((f) => f.id === hold);
  const name = fac?.name ?? hold;
  if (heat > 0.75) return `${name} are losing ${s.name}. A scheme is ripe.`;
  if (heat > 0.45) return `${name} hold ${s.name} — barely.`;
  return `${name} hold ${s.name}.`;
}

export function rivalSettlement(world: WorldId, factionId: string): Settlement | null {
  const towns = settlementsOf(world);
  return towns.find((t) => t.faction !== factionId) ?? towns[1] ?? null;
}

export function tickPolitics(k: Kernel, world: WorldId, owners: Record<string, string>, dt: number): string | null {
  const facs = factionsOf(world);
  if (!facs.length) return null;
  k.polCd -= dt;
  if (k.polCd > 0) return null;
  k.polCd = 18;
  const rng = mulberry32(xmur3(`${world}:pol:${k.day}:${Math.floor(k.hour)}`)());
  if (rng() > 0.42) return null;
  const f = pick(rng, facs);
  const d = (rng() - 0.45) * 0.14;
  bumpHeat(f.id, d);
  k.factionHeat = Math.max(0, Math.min(1, k.factionHeat + d * 0.6));
  if (k.factionHeat > 0.82 && rng() > 0.35) {
    const towns = settlementsOf(world);
    if (towns.length) {
      const t = pick(rng, towns);
      if (t && t.faction !== f.id) {
        owners[t.id] = f.id;
        seizeSettlement(t.id, f.id, world);
        return `${f.name} seized ${t.name}. The kingdom did not ask you.`;
      }
    }
  }
  return `${f.name}: ${f.want}. Heat ${Math.round(heatOf(f.id) * 100)}.`;
}

export function awayPolitics(world: WorldId, hours: number, owners: Record<string, string>, k: Kernel): string | null {
  if (hours < 0.6) return null;
  const steps = Math.min(6, Math.floor(hours));
  let last: string | null = null;
  for (let i = 0; i < steps; i++) {
    k.polCd = 0;
    const line = tickPolitics(k, world, owners, 20);
    if (line) last = line;
  }
  const title = worldKit(world).title;
  const b = bible(world);
  if (!last && hours > 2) last = `${b.kingdoms[0] ?? title} kept its own hours for ${hours.toFixed(1)}h.`;
  return last;
}
