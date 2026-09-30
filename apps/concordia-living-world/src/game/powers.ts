import type { FightingStyle } from "./worlds";

export type ArtKind = "light" | "heavy" | "special" | "power";

export type Art = {
  id: string;
  name: string;
  key: string;
  kind: ArtKind;
  flavor: string;
};

/** Named catalog — weather and hostility pick from these, they are not dice. */
export const ART_POOL = [
  { id: "palm", name: "Palm", flavor: "Open hand. The Court still prefers this." },
  { id: "shoulder", name: "Shoulder", flavor: "Mass, not a blade." },
  { id: "flower-step", name: "Flower-step", flavor: "The ground refuses the strike and you step through." },
  { id: "lantern", name: "Lantern step", flavor: "A guest's dash. Iframes, then light." },
  { id: "ash-cut", name: "Ash cut", flavor: "A keeper's stroke. The unburied flinch." },
  { id: "unburial", name: "Unburial", flavor: "You pull a fall back into standing." },
  { id: "refuse-ending", name: "Refuse ending", flavor: "Nothing here is allowed to finish, including the fight." },
  { id: "reed", name: "Reed", flavor: "Flexible. The grove teaches yield." },
  { id: "grove-root", name: "Grove-root", flavor: "You take poise from soil that was never reaped." },
  { id: "do-not-reap", name: "Do not reap", flavor: "Heal. Take fruit, never the tree." },
  { id: "pollen-ward", name: "Pollen ward", flavor: "A veil. Hostility settles." },
  { id: "ward-blade", name: "Ward-blade", flavor: "Edge held, not spent." },
  { id: "curse-held", name: "Curse-held", flavor: "The blow you could win with, kept inward." },
  { id: "turn-inward", name: "Turn it inward", flavor: "Hostility becomes your own lesson." },
  { id: "curse-fold", name: "Curse-fold", flavor: "Fold the overflow. Poise returns." },
  { id: "switch", name: "Switch", flavor: "Fast. The bill is later." },
  { id: "iron", name: "Iron", flavor: "A yard punch. Witnesses remember." },
  { id: "delay-bill", name: "Delay the bill", flavor: "The hit lands after the room has already moved on." },
  { id: "invoice", name: "Invoice", flavor: "Collect every delayed debt at once." },
  { id: "pulse", name: "Pulse", flavor: "A number the Grid cannot file." },
  { id: "overflow", name: "Stack overflow", flavor: "Too much to count. That is the point." },
  { id: "refuse-number", name: "Refuse the number", flavor: "Damage hides until you let it exist." },
  { id: "null-flush", name: "Null flush", flavor: "Dump the uncounted as a ring." },
  { id: "dust-kick", name: "Dust-kick", flavor: "The road answers with grit." },
  { id: "wagon-iron", name: "Wagon iron", flavor: "Heavy as a wheel hub." },
  { id: "leave-dome", name: "Leave the dome", flavor: "Sprint. The fence was never architecture." },
  { id: "dust-sprint", name: "Dust sprint", flavor: "Wind at your back. Bound opens." },
  { id: "fist", name: "Fist", flavor: "A bottom-up punch. No costume required." },
  { id: "shockwave", name: "Shockwave", flavor: "The plaza notices. Civilians do not fall." },
  { id: "refuse-win", name: "Refuse the win", flavor: "Mercy. They stand. The dawn does not end." },
  { id: "mercy-shock", name: "Mercy shock", flavor: "Knock them down without taking the sunrise." },
  { id: "shard", name: "Shard", flavor: "A piece of unfinished weather." },
  { id: "recycle", name: "Recycle", flavor: "The lattice uses the same blow twice." },
  { id: "refuse-completion", name: "Refuse completion", flavor: "If it would end, un-end it." },
  { id: "un-end", name: "Un-end", flavor: "A drift-event walks through the fight." },
  { id: "dive", name: "Dive", flavor: "From height. Dodge the sweep." },
  { id: "census", name: "Census pulse", flavor: "The drone names you. You refuse." },
  { id: "tide", name: "Tide-rush", flavor: "A sealie teaches the grove to shove." },
  { id: "flank", name: "Flank", flavor: "Wolves do not wait for a fair angle." },
  { id: "stare", name: "Basilisk stare", flavor: "A grab you must dodge, not parry." },
] as const;

export function artsFor(style: FightingStyle, weather: string): Art[] {
  const weatherPower: Record<string, string> = {
    rain: "invoice",
    wind: "dust-sprint",
    ash: "unburial",
    neon: "null-flush",
    drift: "un-end",
    dawn: "mercy-shock",
    grove: "pollen-ward",
    dust: "dust-kick",
    clear: style.id === "court" ? "lantern" : "curse-fold",
  };
  const powerId = weatherPower[weather] ?? style.id;
  const power = ART_POOL.find((a) => a.id === powerId) ?? ART_POOL.find((a) => a.id === "lantern")!;
  return [
    { id: "light", name: style.light, key: "LMB", kind: "light", flavor: `${style.name} — light.` },
    { id: "heavy", name: style.heavy, key: "RMB", kind: "heavy", flavor: `${style.name} — heavy.` },
    { id: "special", name: style.special, key: style.specialKey, kind: "special", flavor: style.power },
    { id: power.id, name: power.name, key: style.powerKey, kind: "power", flavor: power.flavor },
  ];
}

export function powerFlavor(style: FightingStyle, weather: string) {
  return artsFor(style, weather)[3]!;
}
