import type { WorldId } from "./content";
import { CROSS_PLOTS } from "./bible";
import { loadLiving, saveLiving } from "./persist";
import type { LiveQuest } from "./quests";

export function plotStage(id: string): number {
  return loadLiving().plots[id] ?? 0;
}

export function advancePlot(id: string, by = 1): number {
  const all = loadLiving();
  const next = Math.min(3, (all.plots[id] ?? 0) + by);
  all.plots[id] = next;
  if (!all.cross.includes(id)) all.cross.push(id);
  const plot = CROSS_PLOTS.find((p) => p.id === id);
  if (plot && next >= 1) {
    for (const w of plot.worlds) {
      const tag = travelerTag(w);
      if (tag && !all.travelers.includes(tag)) all.travelers.push(tag);
    }
  }
  saveLiving(all);
  return next;
}

export function markVisitedWorld(world: WorldId) {
  const all = loadLiving();
  for (const p of CROSS_PLOTS) {
    if (!p.worlds.includes(world)) continue;
    const key = `seen:${p.id}:${world}`;
    if (!all.cross.includes(key)) all.cross.push(key);
  }
  saveLiving(all);
}

export function travelerTag(world: WorldId): string | null {
  const map: Partial<Record<WorldId, string>> = {
    crime: "mama",
    cyber: "nyx",
    fantasy: "thorne",
    "lattice-crucible": "lyra",
    "concord-link-frontier": "lamplighter",
    superhero: "elias",
    "sovereign-ruins": "seraphine",
    tunya: "vesper",
  };
  return map[world] ?? null;
}

export function livingLines(npcId: string): string[] {
  const extra: string[] = [];
  for (const p of CROSS_PLOTS) {
    const stage = plotStage(p.id);
    if (stage <= 0) continue;
    if (p.id === "plot-bill" && (npcId === "mama" || npcId === "jax" || npcId === "mama-yard")) {
      extra.push(
        stage >= 2
          ? "The invoice followed you through a door. I said it would. My people are still split."
          : "Someone walked a delayed hit out of the yard. The Court will pretend it was etiquette.",
      );
    }
    if (p.id === "plot-uncounted" && (npcId === "nyx" || npcId === "zero" || npcId === "nyx-grid")) {
      extra.push(
        stage >= 2
          ? "The Grid skipped four numbers after you left. I filed you as a guest who would not stay counted."
          : "Walk the Blackout Stack. Then come back. I want the census to fail in public.",
      );
    }
    if (p.id === "plot-curse" && (npcId === "thorne" || npcId === "thorne-field")) {
      extra.push(
        stage >= 2
          ? "The hostility you fed in the grove followed you home as a rumor. I am still not the dragon."
          : "If you meet the drake, do not finish it. That is the whole plot.",
      );
    }
    if (p.id === "plot-road" && (npcId === "lamplighter" || npcId === "ren-road")) {
      extra.push(
        stage >= 2
          ? "Frontier walkers still have no seat. Every road you walked is the argument. I am lighting it anyway."
          : "They will not get a ninth door. They will get a road. Walk it so the Ring has to notice.",
      );
    }
    if (p.id === "plot-eighth" && (npcId === "lyra" || npcId === "lyra-crucible" || npcId === "veil-keeper")) {
      extra.push(
        stage >= 2
          ? "You have seen the Second Hour and the grove that wrote the Refusals. I still will not teach a ninth."
          : "Iyatte says the Refusals were written in Tunya. I keep the door. Do not ask me to close it.",
      );
    }
  }
  return extra.slice(0, 2);
}

export function plotLine(): string {
  const all = loadLiving();
  const live = CROSS_PLOTS.filter((p) => (all.plots[p.id] ?? 0) > 0);
  if (!live.length) return "Eight doors. No plot has followed you home — yet.";
  const p = live[live.length - 1]!;
  const st = all.plots[p.id] ?? 1;
  return `${p.title} · stage ${st}/3`;
}

export function onQuestTouched(q: LiveQuest) {
  if (q.kind === "cross" || q.loreRef.startsWith("plot-")) {
    advancePlot(q.loreRef.startsWith("plot-") ? q.loreRef : q.id.replace(/-\d+$/, ""));
  }
}

export function completeCrossOnTravel(from: WorldId, to: WorldId): string | null {
  const hit = CROSS_PLOTS.find((p) => p.worlds.includes(from) && p.worlds.includes(to));
  if (!hit) return null;
  const n = advancePlot(hit.id);
  markVisitedWorld(to);
  return n >= 1 ? `${hit.title} walked with you through the door.` : null;
}
