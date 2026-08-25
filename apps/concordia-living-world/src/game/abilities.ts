import type { AttackKind } from "./combat";
import { beginAttack, beginDodge, type Combatant } from "./combat";
import type { FightingStyle } from "./worlds";
import { artsFor, type Art } from "./powers";

export type AbilityId = "light" | "heavy" | "special" | "ward" | "power";

export function specialKind(style: FightingStyle): AttackKind {
  if (style.id === "keepers" || style.id === "dawn" || style.id === "sundering") return "heavy";
  if (style.id === "zero" || style.id === "ghost") return "riposte";
  return "light";
}

export function trySpecial(c: Combatant, style: FightingStyle, now: number): boolean {
  return beginAttack(c, specialKind(style), now);
}

export function tryPower(c: Combatant, style: FightingStyle, now: number): boolean {
  if (style.id === "road" || style.id === "court" || style.id === "veil") {
    return beginDodge(c, now, true);
  }
  const kind: AttackKind = style.id === "dawn" || style.id === "drift" || style.id === "keepers" ? "heavy" : "light";
  return beginAttack(c, kind, now);
}

export function styleMomentumMul(style: FightingStyle, kind: AttackKind): number {
  const base = kind === "heavy" ? 1.22 : kind === "riposte" ? 1.15 : 1;
  return base * style.massMul;
}

export function hudArts(style: FightingStyle, weather: string): Art[] {
  return artsFor(style, weather);
}

export const ABILITY_HELP = [
  { key: "Click", label: "Light" },
  { key: "RMB", label: "Heavy" },
  { key: "G", label: "World art" },
  { key: "1", label: "Weather art" },
  { key: "F", label: "Parry" },
  { key: "Space", label: "Dodge" },
] as const;
