import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");
const sereFactions = join(root, "content/world/sere/factions.json");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("SR2 street floor — source contracts", () => {
  it("player bind prefers rocketbox adults and drops Mixamo clips that T-pose", () => {
    const person = src("ModularPerson.cs");
    const game = src("ConcordiaGame.cs");
    assert.match(person, /AttachHero\(/);
    assert.match(person, /hero \?/);
    assert.match(person, /rocketbox\/Male_Adult_01/);
    assert.match(person, /Never Mixamo Soldier/);
    assert.match(person, /clipsFit/);
    assert.match(person, /ApplyAuthoredGait/);
    assert.match(person, /Bip01 L UpperArm/);
    assert.match(person, /Bip01 Pelvis/);
    assert.match(person, /_biped/);
    assert.match(person, /BipedArm\(/);
    assert.match(person, /FromToRotation/);
    assert.match(person, /TryBipedAvatar/);
    assert.match(person, /AvatarBuilder\.BuildHumanAvatar/);
    assert.match(person, /BipedHinge\(/);
    assert.match(person, /_speed > 0.35f/);
    assert.match(person, /_clipsFit && !_biped && _authored/);
    assert.match(person, /_clipsFit = !_biped &&/);
    assert.match(person, /StripPrefabWeapons/);
    assert.match(person, /_footL\.position\.y/);
    assert.match(person, /float contra = -s \* armAmp/);
    assert.match(person, /_shown < 0\.35f && _grounded\) PlantFeet/);
    assert.doesNotMatch(person, /LoadAssetAtPath.*Soldier\.glb/);
    assert.match(game, /ModularPerson\.AttachHero\(/);
  });

  it("CityTown lays a PBR plaza, cross streets, flora, and authored outskirts", () => {
    const fill = src("RealmFill.cs");
    assert.match(fill, /PlazaPad\(/);
    assert.match(fill, /HubLook\.Pbr\(/);
    assert.match(fill, /CrossStreets\(/);
    assert.match(fill, /EdgeFlora\(/);
    assert.match(fill, /Outskirts\(/);
    assert.match(fill, /EvoSpawner\.SpawnNamed/);
    assert.match(fill, /JobFor\(/);
    assert.doesNotMatch(fill, /Concord admits he loves her/);
    assert.match(fill, /No authored dungeon name/);
  });

  it("CityAtlas cache clears on every world build", () => {
    const book = src("WorldBook.cs");
    const builder = src("WorldBuilder.cs");
    assert.match(book, /public static void Invalidate\(\)/);
    assert.match(builder, /CityAtlas\.Invalidate\(\)/);
    assert.match(builder, /concordia-atlas\.txt/);
  });

  it("Sere factions carry authored districts the atlas can seat", () => {
    const factions = JSON.parse(readFileSync(sereFactions, "utf8"));
    assert.ok(Array.isArray(factions) && factions.length >= 8);
    const seated = factions.filter((f) => Array.isArray(f.controlled_districts) && f.controlled_districts.length > 0);
    assert.ok(seated.length >= 8, "Sere factions with districts=" + seated.length);
    for (const f of seated) {
      assert.ok(f.id && f.name, "faction needs id+name");
      assert.ok(!/ninth refusal/i.test(f.name));
    }
  });

  it("interior slabs and Kenney paint use real textures, not a flat color", () => {
    const interior = src("BuildingInterior.cs");
    const packs = src("FreePacks.cs");
    assert.match(interior, /HubLook\.Pbr\(pbr/);
    assert.match(packs, /for \(int up = 0; up < 4/);
    assert.match(packs, /colormap\.png/);
    assert.match(packs, /IsClothName/);
    assert.match(packs, /DyeCloth\(/);
    assert.match(packs, /SitOrHang\(/);
  });

  it("Hub grade and clock leave the HDR sky readable, not crushed to mud", () => {
    const look = src("HubLook.cs");
    const book = src("WorldBook.cs");
    const builder = src("WorldBuilder.cs");
    assert.match(look, /exposure = 0\.12f/);
    assert.match(look, /sat = 10f/);
    assert.match(look, /ambientIntensity = 1f/);
    assert.match(look, /reflectionIntensity = world == WorldId\.Hub \? 1\.05f/);
    assert.match(look, /metallic = 0\.06f, float smooth = 0\.26f/);
    assert.match(look, /SetFloat\("_Smoothness", 0\.22f\)/);
    assert.match(book, /UnityEngine\.Rendering\.AmbientMode\.Trilight/);
    assert.match(book, /World == WorldId\.Hub/);
    assert.match(book, /l\.name == "Sun"/);
    assert.match(book, /sun\.intensity = 0\.92f \+ 0\.38f \* day/);
    assert.match(builder, /1\.18f/);
    assert.match(builder, /0\.0045f/);
    assert.doesNotMatch(look, /exposure = -0\.72f/);
  });

  it("crowd walkers keep a ring and idle bodies still move", () => {
    const life = src("NpcLife.cs");
    const person = src("ModularPerson.cs");
    const builder = src("WorldBuilder.cs");
    assert.match(life, /WanderRing\(/);
    assert.match(life, /PaceRing\(/);
    assert.match(life, /IsWalkingJob/);
    assert.match(life, /if \(job == Job.Watch \|\| job == Job.Sweep\)/);
    assert.match(life, /if \(IsWalkingJob\)/);
    assert.match(life, /Notice\(other\.transform, 1\.8f\)/);
    assert.match(person, /Talking\(\)/);
    assert.match(person, /PlanarSpeed/);
    assert.match(person, /talkLift/);
    assert.match(person, /FORCE_REFRESH_0022/);
    assert.match(person, /18f \+ arc/);
    assert.match(builder, /for \(int i = 0; i < 16; i\+\+\)/);
    assert.match(builder, /for \(int i = 0; i < 24; i\+\+\)/);
  });

  it("portal swirl is a small alpha mote, not a 3m additive oval", () => {
    const plaza = src("HubPlaza.cs");
    const look = src("HubLook.cs");
    assert.match(plaza, /startSize = 0.05f/);
    assert.match(plaza, /sh.radius = 0.42f/);
    assert.match(plaza, /ParticleMat\(c, false\)/);
    assert.match(look, /bool additive = true/);
    assert.doesNotMatch(plaza, /startSize = 0.28f/);
    assert.doesNotMatch(plaza, /sh.radius = 1.6f/);
    assert.match(plaza, /new Vector3\(2\.4f, 0\.06f, 4\.2f\)/);
    assert.doesNotMatch(plaza, /w \* 0\.72f, 0\.12f, h \* 0\.72f/);
    assert.match(plaza, /GodRays\(root\)/);
    assert.match(plaza, /RingWalk/);
    assert.match(plaza, /UnpavedKeep/);
    assert.match(plaza, /MossVerge/);
    assert.match(plaza, /DressVocab\.Tree\(/);
    assert.match(plaza, /DressVocab\.Grass\(/);
    assert.match(plaza, /DressVocab\.Table\(/);
    assert.match(src("CharacterGear.cs"), /FromToRotation\(from, boneLocal\)/);
    assert.match(src("CharacterGear.cs"), /boneLocal \* 0\.08f/);
    assert.match(src("CharacterGear.cs"), /hand\.position - hand\.parent\.position/);
    assert.match(src("HubLook.cs"), /stem \+ "_rough_2k/);
    assert.match(src("NpcLife.cs"), /Grounding\.Snap\(_cc\)/);
  });

  it("kit HUD, typed 2B talk, building enter, and human-scale clutter", () => {
    const player = src("ConcordiaPlayer.cs");
    const hud = src("ConcordiaHUD.cs");
    const game = src("ConcordiaGame.cs");
    const obj = src("HubObjectives.cs");
    const packs = src("FreePacks.cs");
    const life = src("NpcLife.cs");
    const plaza = src("HubPlaza.cs");
    const interior = src("BuildingInterior.cs");
    assert.match(obj, /class KitBag/);
    assert.match(obj, /HoldWeapon/);
    assert.match(obj, /ArtName/);
    assert.match(player, /menuOpen/);
    assert.match(player, /talkOpen/);
    assert.match(player, /OpenTalk/);
    assert.match(player, /SubmitTalk/);
    assert.match(player, /HoldFromBag/);
    assert.match(hud, /GUI\.TextField/);
    assert.match(hud, /TalkDraft/);
    assert.match(hud, /KitMenu/);
    assert.match(life, /class UsePlace/);
    assert.match(life, /NearestDoor/);
    assert.match(packs, /HumanHeight/);
    assert.match(packs, /var hh = HumanHeight\(stem\)/);
    assert.match(packs, /if \(hh > 0\.01f\) maxDim = hh/);
    assert.match(game, /UsePlace\.Nearest/);
    assert.match(game, /NearestDoor/);
    assert.match(game, /OpenTalk/);
    assert.match(game, /SubmitTalk/);
    assert.match(game, /2B is not on this box/);
    assert.match(game, /KitBag\.AddLoot/);
    assert.match(game, /EnterBuilding/);
    assert.match(plaza, /UsePlace\.Stamp/);
    assert.match(plaza, /HumanHeight/);
    assert.match(interior, /HumanHeight/);
    assert.match(interior, /public bool entered/);
    assert.doesNotMatch(plaza, /DressCityRing/);
  });

  it("authored gait is a jog/run, not a high-step march", () => {
    const person = src("ModularPerson.cs");
    assert.match(person, /float jog = Mathf\.InverseLerp/);
    assert.match(person, /float run = Mathf\.InverseLerp/);
    assert.match(person, /kneeSwing/);
    assert.match(person, /kneeStance/);
    assert.match(person, /_shown < 0\.35f && _grounded\) PlantFeet/);
    assert.doesNotMatch(person, /Lerp\(6\.4f, 10\.6f/);
    assert.doesNotMatch(person, /56f \* w/);
  });
});
