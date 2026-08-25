/** Animation state machine. Gameplay state is authority; clips only present it. */

import type { AttackKind } from "./combat";
import type { Gait } from "./locomotion";

export type LocoClip = "Idle" | "Walk" | "Run";
export type CombatPhase = "none" | "anticipate" | "accel" | "contact" | "follow" | "recover";

export function locoClip(gait: Gait, speed: number): LocoClip {
  if (gait === "air") return speed > 1.2 ? "Run" : speed > 0.35 ? "Walk" : "Idle";
  if (gait === "land" || gait === "dodge") return speed > 0.8 ? "Walk" : "Idle";
  if (gait === "sprint" || gait === "jog" || speed > 4.2) return "Run";
  if (gait === "walk" || gait === "crouch" || speed > 0.35) return "Walk";
  return "Idle";
}

/** Attacks may be cancelled into dodge/move during recovery; startup is sticky. */
export function canCancel(phase: CombatPhase, into: "dodge" | "move" | "attack"): boolean {
  if (phase === "none") return true;
  if (into === "dodge") return phase === "anticipate" || phase === "follow" || phase === "recover";
  if (into === "move") return phase === "recover" || phase === "follow";
  if (into === "attack") return phase === "recover";
  return false;
}

export function attackSwing(phase: CombatPhase, u: number, kind: AttackKind | null): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  if (phase === "anticipate") {
    x = -1.15 * u;
    y = 0.35 * u;
    z = 0.2 * u;
  } else if (phase === "accel") {
    x = -1.15 + 3.2 * u;
    y = 0.35 - 0.9 * u;
    z = 0.2 - 0.85 * u;
  } else if (phase === "contact") {
    x = 2.05;
    y = -0.55;
    z = -0.65;
  } else if (phase === "follow") {
    x = 2.05 - 0.9 * u;
    y = -0.55 + 0.2 * u;
    z = -0.65 + 0.25 * u;
  } else if (phase === "recover") {
    x = 1.15 * (1 - u);
    y = -0.35 * (1 - u);
    z = -0.4 * (1 - u);
  }
  const k = kind === "heavy" ? 1.22 : 1;
  return { x: x * k, y: y * k, z: z * k };
}
