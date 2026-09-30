import { bible } from "./bible";
import type { WorldId } from "./content";
import { settlementsOf } from "./realms";

export type LoreStone = {
  id: string;
  x: number;
  z: number;
  title: string;
  text: string;
};

export function enterCopy(world: WorldId) {
  const b = bible(world);
  if (world === "concordia-hub") {
    return "The Court Unburned. No live steel except the Arena. You cannot own the heart.";
  }
  return `${b.refusal} — ${b.laws[0]?.text ?? b.thesis}. Steel is live.`;
}

export function loreStones(world: WorldId): LoreStone[] {
  const b = bible(world);
  const out: LoreStone[] = [];
  if (world === "concordia-hub") {
    out.push({
      id: "hub-heart",
      x: 0,
      z: 0,
      title: b.signatureLocation,
      text: `${b.thesis} ${b.lore[0]?.text ?? ""}`,
    });
    out.push({
      id: "hub-arena",
      x: 0,
      z: 32,
      title: "The Arena",
      text: b.laws[0]?.text ?? "Blades live only here.",
    });
    return out;
  }
  out.push({
    id: `${world}-door`,
    x: 0,
    z: 0,
    title: b.signatureLocation,
    text: `${b.thesis} ${b.lore[0]?.text ?? b.refusal}`,
  });
  out.push({
    id: `${world}-law`,
    x: 5,
    z: 10,
    title: b.laws[0]?.id ?? "LAW",
    text: `${b.laws[0]?.text ?? b.refusal}. ${b.laws[0]?.mechanic ?? ""}`,
  });
  if (b.lore[1]) {
    out.push({
      id: `${world}-lore2`,
      x: -6,
      z: -8,
      title: b.lore[1].id,
      text: `${b.lore[1].text} — ${b.lore[1].realization}`,
    });
  }
  for (const s of settlementsOf(world)) {
    out.push({
      id: s.id,
      x: s.x + 2.4,
      z: s.z - 2.2,
      title: s.name,
      text: `${s.purpose}. ${b.kingdoms[0] ?? ""} holds this.`,
    });
  }
  return out;
}

export function nearestStone(world: WorldId, x: number, z: number, max = 3.2) {
  let best: { s: LoreStone; d: number } | null = null;
  for (const s of loreStones(world)) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d > max) continue;
    if (!best || d < best.d) best = { s, d };
  }
  return best;
}

export function isSignatureKill(world: WorldId, kind?: string) {
  if (!kind) return false;
  const s = bible(world).signatureCreature.toLowerCase();
  return s.includes(kind.toLowerCase());
}
