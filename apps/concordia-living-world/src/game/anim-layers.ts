import type { AttackKind } from "./combat";
import type { Gait } from "./locomotion";
import { locoClip, type LocoClip } from "./anim-machine";

export type LayerWeights = {
  idle: number;
  walk: number;
  run: number;
  combat: number;
  hit: number;
  air: number;
  loco: LocoClip;
};

/** Gameplay state → layer weights. Legs keep locomotion while combat overlays. */
export function layerWeights(opts: {
  gait: Gait;
  speed: number;
  hop: number;
  stagger: boolean;
  attacking: boolean;
}): LayerWeights {
  const loco = locoClip(opts.gait, opts.speed);
  const air = opts.gait === "air" || opts.hop > 0.12 ? 1 : 0;
  const hit = opts.stagger ? 1 : 0;
  const combat = opts.attacking ? 1 : 0;
  return {
    idle: loco === "Idle" ? 1 : 0,
    walk: loco === "Walk" ? 1 : 0,
    run: loco === "Run" ? 1 : 0,
    combat,
    hit,
    air,
    loco,
  };
}
