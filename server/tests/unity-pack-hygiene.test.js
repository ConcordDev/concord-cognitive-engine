import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const gitignore = readFileSync(join(root, ".gitignore"), "utf8");

describe("Unity Asset Store pack hygiene", () => {
  it("ignores the untracked store packs instead of vendoring them", () => {
    const packs = [
      "3DForge/",
      "ADG_Textures/",
      "ALP_Assets/",
      "BodyGuards/",
      "Cartoon_Texture_Pack/",
      "Free Island Collection/",
      "Free Pack/",
      "InnerverseInteractive/",
      "Medieval Action - FX Pack 2.0/",
      "NatureStarterKit/",
      "RPG_FPS_game_assets_industrial/",
      "RPG_inventory_icons/",
      "Rocks and Boulders 2/",
      "TreePackVol.1/",
      "YughuesFreeMetalMaterials/",
      "_Creepy_Cat/",
      "Captures/",
      "LLMManager.json",
    ];
    for (const p of packs) {
      assert.ok(gitignore.includes(p), `gitignore missing ${p}`);
    }
  });
});
