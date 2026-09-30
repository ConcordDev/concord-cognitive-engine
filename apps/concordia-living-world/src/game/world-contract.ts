import type { WorldId } from "./content";
import type { BeastKind } from "./worlds";

export type WorldContract = {
  id: WorldId;
  fantasy: string;
  traversal: string;
  combat: string;
  fauna: BeastKind[];
  kenneyTrees: string[];
  kenneyRocks: string[];
};

/** Nine worlds. No Sere. */
export const WORLD_CONTRACTS: Record<WorldId, WorldContract> = {
  "concordia-hub": {
    id: "concordia-hub",
    fantasy: "court and lanterns",
    traversal: "plaza walk",
    combat: "unarmed court",
    fauna: [],
    kenneyTrees: ["tree_oak.glb", "tree_simple.glb", "tree_default.glb"],
    kenneyRocks: ["rock_smallA.glb", "rock_smallB.glb"],
  },
  "sovereign-ruins": {
    id: "sovereign-ruins",
    fantasy: "death that will not finish",
    traversal: "ruins climb, ash roads",
    combat: "heavy remnant",
    fauna: ["wraith", "wolf", "griffin"],
    kenneyTrees: ["tree_tall_dark.glb", "tree_oak_dark.glb", "tree_thin_dark.glb", "tree_detailed_dark.glb"],
    kenneyRocks: ["rock_largeA.glb", "cliff_cave_stone.glb", "rock_tallE.glb", "cliff_stone.glb"],
  },
  tunya: {
    id: "tunya",
    fantasy: "soil that answers",
    traversal: "grove and mesa",
    combat: "living wood",
    fauna: ["hound", "sealie", "harpy"],
    kenneyTrees: ["tree_oak.glb", "tree_pineTallA.glb", "tree_pineDefaultA.glb"],
    kenneyRocks: ["rock_largeB.glb", "rock_smallC.glb"],
  },
  fantasy: {
    id: "fantasy",
    fantasy: "held curse",
    traversal: "wild climb",
    combat: "ward steel",
    fauna: ["wolf", "griffin", "basilisk"],
    kenneyTrees: ["tree_pineDefaultA.glb", "tree_tall.glb", "tree_oak.glb"],
    kenneyRocks: ["rock_largeA.glb", "rock_tallC.glb"],
  },
  crime: {
    id: "crime",
    fantasy: "heat and witnesses",
    traversal: "streets and roofs",
    combat: "close knives",
    fauna: ["hound", "drone"],
    kenneyTrees: ["tree_simple.glb", "tree_thin_dark.glb"],
    kenneyRocks: ["rock_smallA.glb", "rock_smallB.glb"],
  },
  cyber: {
    id: "cyber",
    fantasy: "identity as terrain",
    traversal: "parkour infrastructure",
    combat: "drone and pulse",
    fauna: ["drone", "sentinel", "construct"],
    kenneyTrees: ["tree_simple.glb"],
    kenneyRocks: ["rock_tallA.glb", "cliff_rock.glb"],
  },
  "concord-link-frontier": {
    id: "concord-link-frontier",
    fantasy: "roads between refusals",
    traversal: "wagon and wind",
    combat: "open range",
    fauna: ["hound", "wolf"],
    kenneyTrees: ["tree_pineSmallA.glb", "tree_simple.glb"],
    kenneyRocks: ["rock_largeD.glb", "cliff_large_rock.glb"],
  },
  superhero: {
    id: "superhero",
    fantasy: "height as verb",
    traversal: "vertical city",
    combat: "impact",
    fauna: ["drone", "sentinel"],
    kenneyTrees: ["tree_simple.glb", "tree_default.glb"],
    kenneyRocks: ["rock_smallA.glb"],
  },
  "lattice-crucible": {
    id: "lattice-crucible",
    fantasy: "rules that refuse to stay",
    traversal: "unstable ground",
    combat: "drift",
    fauna: ["drift", "wraith", "construct"],
    kenneyTrees: ["tree_thin_dark.glb", "tree_default_dark.glb"],
    kenneyRocks: ["rock_tallC.glb", "cliff_large_stone.glb"],
  },
};
