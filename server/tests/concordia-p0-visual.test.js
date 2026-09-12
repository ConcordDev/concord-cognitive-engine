import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia P0 visual punch-list — source contracts", () => {
  it("P0-7 art lock is one Unity sentence; the BotW guide is retired for Unity", () => {
    const lock = readFileSync(join(root, "docs/UNITY_ART_LOCK.md"), "utf8");
    const guide = readFileSync(join(root, "docs/ART_STYLE_GUIDE.md"), "utf8");
    assert.match(lock, /store-pack realism/);
    assert.match(lock, /KayKit Knight/);
    assert.match(guide, /RETIRED FOR THE UNITY CLIENT/);
    assert.match(guide, /UNITY_ART_LOCK/);
  });

  it("P0-1 LoadPersonPrefab reads CastingWorld; steel worlds are Knight not polo", () => {
    const person = src("ModularPerson.cs");
    assert.match(person, /CastingWorld != WorldId\.Hub/);
    assert.match(person, /SteelCostumePath\(CastingWorld\)/);
    assert.match(person, /kaykit\/adventures\/gltf\/Knight\.glb/);
    assert.match(person, /RecastBody\(/);
    assert.match(person, /RebuildForWorld\(/);
    assert.match(src("ConcordiaGame.cs"), /ModularPerson\.RecastBody\(/);
    assert.match(person, /rocketbox\/Male_Adult_01/);
  });

  it("P0-2 Hub plaza is pack architecture — no Rib cubes, no primitive dome city", () => {
    const plaza = src("HubPlaza.cs");
    assert.match(plaza, /SpawnStore\("granite_panel"/);
    assert.match(plaza, /SpawnStore\("stone_column"/);
    assert.match(plaza, /SpawnStore\("stone_half_gate"/);
    assert.match(plaza, /SpawnStore\("plaza_floor"/);
    assert.match(src("FreePacks.cs"), /Missing_/);
    assert.doesNotMatch(plaza, /Rib/);
    assert.doesNotMatch(plaza, /GodRays/);
    assert.doesNotMatch(plaza, /RingBoxes/);
    assert.doesNotMatch(plaza, /PrimitiveType\.Cylinder/);
    assert.doesNotMatch(src("WorldBuilder.cs"), /Material_SandLumpy/);
  });

  it("P0-3 grounding has no 4.5m ceiling hack; NpcLife Snap uses Grounding", () => {
    const g = src("Grounding.cs");
    const life = src("NpcLife.cs");
    const game = src("ConcordiaGame.cs");
    assert.match(g, /SnapPoint\(/);
    assert.doesNotMatch(g, /4\.5f/);
    assert.doesNotMatch(g, /y = 0\.08f/);
    assert.match(life, /Grounding\.SnapPoint/);
    assert.doesNotMatch(game, /py > 3\.5f/);
  });

  it("P0-4 Hub night is Sun01=0 at 23:04, not noon-minus-UI", () => {
    const look = src("HubLook.cs");
    const book = src("WorldBook.cs");
    assert.match(look, /ApplyHour\(/);
    assert.match(look, /Sun01\(/);
    assert.match(look, /0\.06f \+ 1\.12f \* sun01/);
    assert.match(book, /HubLook\.ApplyHour\(World, Hour\)/);
    assert.doesNotMatch(book, /0\.92f \+ 0\.38f \* day/);
  });

  it("P0-5 forest spawn is store-only; Kenney tree_oak is not the Hub ring", () => {
    const builder = src("WorldBuilder.cs");
    const packs = src("FreePacks.cs");
    const fill = src("RealmFill.cs");
    assert.match(builder, /SpawnStore\(stem/);
    assert.match(builder, /"tree_1"/);
    assert.doesNotMatch(builder, /tree_oak/);
    assert.match(packs, /SpawnStore\(/);
    assert.match(fill, /RingStore\(/);
    assert.doesNotMatch(fill, /tree_oak_dark/);
  });

  it("P0-6 play HUD is compass + rings + prompt; kernel dump is F8 default off", () => {
    const hud = src("ConcordiaHUD.cs");
    assert.match(hud, /public static bool DebugHud/);
    assert.match(hud, /KeyCode\.F8/);
    assert.match(hud, /Compass\(w\)/);
    assert.match(hud, /Rings\(w\)/);
    assert.match(hud, /Prompt\(w, h\)/);
    assert.match(hud, /if \(DebugHud\)/);
    const onGui = hud.slice(hud.indexOf("void OnGUI()"), hud.indexOf("void Hints("));
    assert.match(onGui, /if \(DebugHud\)[\s\S]*Vitals\(\)/);
    assert.doesNotMatch(onGui, /Compass\(w\);\s*Vitals\(\)/);
  });
});
