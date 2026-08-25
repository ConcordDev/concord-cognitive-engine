import { NPCS, SPAWN, THEMES, type WorldId } from "./content";
import { freshCombatant, type Combatant } from "./combat";
import { createJuice, type Juice } from "./juice";
import { beastDef } from "./creatures";
import { makeKernel, type Kernel } from "./kernel";
import { worldKit, settlementNpcs, type BeastKind, type WorldNpc } from "./worlds";
import { birthCreature, type EvoTraits } from "./evo";
import { emptySlice, readSlice, awayHours, type WorldSlice } from "./persist";
import { rollQuest, type LiveQuest } from "./quests";
import { brainFor, type NpcBrain } from "./npc-life";
import { awayPolitics } from "./politics";
import { applyEvent, rollEvent } from "./events";

export type Pose = "idle" | "walk" | "windup" | "strike" | "dodge" | "hurt" | "down";

export type Actor = {
  id: string;
  body: Combatant;
  yaw: number;
  homeX: number;
  homeZ: number;
  wander: number;
  pose: Pose;
  color: string;
  accent: string;
  height: number;
  lantern?: boolean;
  hostile: boolean;
  telegraph: "thrust" | "sweep" | "grab" | null;
  telegraphUntil: number;
  aiCd: number;
  alive: boolean;
  kind: "npc" | "beast";
  species?: BeastKind;
  flyH: number;
  reviveAt: number;
  morale: number;
  evoName?: string;
  brain?: NpcBrain;
  traits?: EvoTraits;
  packId?: string;
  scale?: number;
};

export type Sim = {
  t: number;
  now: number;
  player: Combatant;
  yaw: number;
  speed: number;
  camYaw: number;
  camPitch: number;
  actors: Actor[];
  juice: Juice;
  foot: number;
  schemeAt: number;
  tickerAt: number;
  visited: Set<string>;
  lastHitAt: number;
  lockId: string | null;
  returnHome: boolean;
  worldId: WorldId;
  kernel: Kernel;
  slice: WorldSlice;
  quest: LiveQuest | null;
  birthCd: number;
  wildSeen: Set<string>;
  wildCd: number;
};

export function spawnActors(world: WorldId, slice?: WorldSlice | null): Actor[] {
  const kit = worldKit(world);
  const extraNpcs = world === "concordia-hub" ? [] : settlementNpcs(world);
  const npcSrc = world === "concordia-hub" ? NPCS : [...kit.npcs, ...extraNpcs];
  const npcs: Actor[] = npcSrc.map((n, i) => ({
    id: n.id,
    body: freshCombatant(n.x, n.z, 0),
    yaw: 0,
    homeX: n.x,
    homeZ: n.z,
    wander: n.wander,
    pose: "idle" as Pose,
    color: n.color,
    accent: n.accent,
    height: n.height,
    lantern: n.id === "lamplighter",
    hostile: n.id === "warden",
    telegraph: null,
    telegraphUntil: 0,
    aiCd: 0,
    alive: true,
    kind: "npc" as const,
    flyH: 0,
    reviveAt: 0,
    morale: 1,
    brain: "need" in n && n.need ? brainFor(world, n as WorldNpc, i) : { homeX: n.x, homeZ: n.z, jobX: n.x, jobZ: n.z, need: "purpose" as const, faction: n.title ?? "court", trust: 0.4, fear: 0 },
  }));
  const beasts: Actor[] = kit.beasts
    .filter((b) => !slice?.dead.includes(b.id))
    .map((b) => {
      const d = beastDef(b.kind);
      const body = freshCombatant(b.x, b.z, 0);
      body.hp = d.hp;
      body.poise = d.poise;
      return {
        id: b.id,
        body,
        yaw: 0,
        homeX: b.x,
        homeZ: b.z,
        wander: 2.2,
        pose: "idle" as Pose,
        color: d.color,
        accent: d.accent,
        height: d.height,
        hostile: b.hostile,
        telegraph: null,
        telegraphUntil: 0,
        aiCd: 0.4,
        alive: true,
        kind: "beast" as const,
        species: b.kind,
        flyH: b.fly ? d.flyHeight : 0,
        reviveAt: 0,
        morale: 1,
        scale: d.scale,
      };
    });
  const births = slice?.births ?? 0;
  for (let i = 0; i < Math.min(6, births); i++) {
    const spec = birthCreature(world, slice?.day ?? 1, i, { x: 80, z: 40 });
    if (!spec) continue;
    const d = beastDef(spec.kind);
    const body = freshCombatant(spec.x, spec.z, 0);
    body.hp = d.hp * spec.scale;
    body.poise = d.poise;
    beasts.push({
      id: spec.id,
      body,
      yaw: 0,
      homeX: spec.x,
      homeZ: spec.z,
      wander: 3.2,
      pose: "idle",
      color: spec.color,
      accent: spec.accent,
      height: d.height * spec.scale,
      hostile: true,
      telegraph: null,
      telegraphUntil: 0,
      aiCd: 0.6,
      alive: true,
      kind: "beast",
      species: spec.kind,
      flyH: spec.fly ? Math.max(d.flyHeight, 3.2) : 0,
      reviveAt: 0,
      morale: 1,
      evoName: spec.name,
      traits: spec.traits,
      scale: d.scale * spec.scale,
    });
  }
  return [...npcs, ...beasts];
}

export function makeSim(world: WorldId): Sim {
  const kit = worldKit(world);
  const start = world === "concordia-hub" ? SPAWN : kit.spawn;
  const p = freshCombatant(start.x, start.z, start.yaw);
  const kernel = makeKernel(world);
  const saved = readSlice(world);
  if (saved) {
    const away = awayHours(saved);
    kernel.ecology = Math.min(1, saved.ecology + away * 0.02);
    kernel.factionHeat = Math.max(0, saved.factionHeat - away * 0.03);
    kernel.prices = saved.prices;
    kernel.day = saved.day + Math.floor(away / 6);
    kernel.hour = (saved.hour + away) % 24;
    kernel.lastEvent = away > 0.4 ? `While you were gone (${away.toFixed(1)}h), ${kit.title} kept its own hours.` : saved.quest?.title ?? kit.system;
    if (away > 1.2) {
      const ev = rollEvent(world, kernel.day, kernel.hour);
      applyEvent(kernel, ev);
      kernel.lastEvent = `While you were gone: ${ev.text}`;
    }
  }
  const slice = saved ?? emptySlice(kernel, world);
  if (!slice.owners || !Object.keys(slice.owners).length) {
    slice.owners = emptySlice(kernel, world).owners;
  }
  const away = awayHours(slice);
  if (away > 0.5) slice.births += 1 + Math.floor(away / 4);
  const pol = awayPolitics(world, away, slice.owners, kernel);
  if (pol) kernel.lastEvent = pol;
  const quest = slice.quest && !slice.quest.done ? slice.quest : rollQuest(world, kernel.day, kernel.factionHeat);
  slice.quest = quest;
  return {
    t: 0,
    now: 0,
    player: p,
    yaw: start.yaw,
    speed: 0,
    camYaw: start.yaw,
    camPitch: -0.28,
    actors: spawnActors(world, slice),
    juice: createJuice(),
    foot: 0,
    schemeAt: 6,
    tickerAt: 11,
    visited: new Set(),
    lastHitAt: 0,
    lockId: null,
    returnHome: false,
    worldId: world,
    kernel,
    slice,
    quest,
    birthCd: 22,
    wildSeen: new Set(),
    wildCd: 4,
  };
}

export { THEMES };
