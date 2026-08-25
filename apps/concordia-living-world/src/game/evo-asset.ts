import type { Object3D } from "three";
import { certifyHumanoid, type HumanoidCert } from "./humanoid-cert";
import type { BeastKind } from "./worlds";

export type FaunaAsset = {
  id: string;
  url: string;
  scale: number;
  y: number;
  fly: boolean;
  license: string;
};

export const FAUNA_ASSETS: Record<string, FaunaAsset> = {
  fox: { id: "fox", url: "/models/fauna/Fox.glb", scale: 0.022, y: 0, fly: false, license: "Khronos CC0" },
  horse: { id: "horse", url: "/models/fauna/Horse.glb", scale: 0.009, y: 0, fly: false, license: "three.js examples" },
  flamingo: { id: "flamingo", url: "/models/fauna/Flamingo.glb", scale: 0.012, y: 0.2, fly: true, license: "three.js examples" },
  parrot: { id: "parrot", url: "/models/fauna/Parrot.glb", scale: 0.018, y: 0.15, fly: true, license: "three.js examples" },
  stork: { id: "stork", url: "/models/fauna/Stork.glb", scale: 0.014, y: 0.2, fly: true, license: "three.js examples" },
};

const KIND_MESH: Record<BeastKind, string> = {
  wolf: "fox",
  hound: "fox",
  griffin: "stork",
  harpy: "parrot",
  dragon: "flamingo",
  wyrm: "flamingo",
  drone: "parrot",
  sentinel: "stork",
  golem: "horse",
  construct: "horse",
  drift: "flamingo",
  wraith: "stork",
  sealie: "fox",
  serpent: "horse",
  spider: "fox",
  basilisk: "horse",
};

export function faunaForKind(
  kind: BeastKind,
  spec?: { scale?: number; fly?: boolean; traits?: { wings?: boolean; horns?: boolean } } | null,
): FaunaAsset {
  let id = KIND_MESH[kind] ?? "fox";
  if (spec?.fly || spec?.traits?.wings) id = spec.traits?.wings ? "parrot" : "flamingo";
  if (spec?.traits?.horns && !spec.fly) id = "horse";
  const a = FAUNA_ASSETS[id] ?? FAUNA_ASSETS.fox;
  return { ...a, scale: a.scale * (spec?.scale ?? 1) };
}

export const PLAYER_HUMANOID = {
  id: "soldier-mixamo",
  url: "/models/Soldier.glb",
  license: "Adobe Mixamo via three.js examples",
  kind: "humanoid" as const,
};

/** Evo certification: a GLB is not a character until this passes. */
export function certifyPlayerRig(root: Object3D): HumanoidCert {
  return certifyHumanoid(root);
}
