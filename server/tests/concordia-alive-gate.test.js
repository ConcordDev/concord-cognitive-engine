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

describe("Concordia alive gate — file-by-file", () => {
  it("Humanoid clips drive walk/run/idle on a valid avatar, including mapped Bip01", () => {
    const person = src("ModularPerson.cs");
    // Cache-bust marker — its number bumps on every forced reimport; pin presence only.
    assert.match(person, /FORCE_REFRESH_\d+/);
    assert.match(person, /TryBipedAvatar/);
    assert.match(person, /AvatarBuilder\.BuildHumanAvatar/);
    assert.match(person, /_clipsFit = ctrl && av && av\.isHuman && av\.isValid/);
    assert.doesNotMatch(person, /_clipsFit = !_biped &&/);
    assert.match(person, /_clipsFit && _authored && _anim/);
    assert.doesNotMatch(person, /_clipsFit && !_biped && _authored/);
    assert.doesNotMatch(person, /&& _speed > 0\.35f/);
    assert.match(person, /_hip\.localPosition = _hipPos0/);
    assert.match(person, /BipedHinge\(/);
    assert.match(person, /rocketbox\/Male_Adult_01/);
    assert.match(person, /Never Mixamo Soldier/);
    assert.doesNotMatch(person, /LoadAssetAtPath.*Soldier\.glb/);
    // Clips drive the body only when they fit; otherwise the authored/primitive gait does.
    // (The Kenney doll path is retired — UNITY_ART_LOCK P0-5.)
    assert.match(person, /bool animating = _clipsFit && _authored/);
    assert.match(person, /if \(_authored\) ApplyAuthoredGait\(\)/);
    assert.doesNotMatch(person, /ApplyKenneyDoll/);
    assert.doesNotMatch(person, /leftHand = rightHand = body\.transform/);
  });

  it("grip refuses body root and only parents to a Hand bone", () => {
    const gear = src("CharacterGear.cs");
    const person = src("ModularPerson.cs");
    // Socket() is the gate: the body root is never a hand; no matched bone = empty hands.
    assert.match(gear, /person\.rightHand && person\.rightHand != root/);
    assert.match(gear, /person\.leftHand && person\.leftHand != root/);
    assert.match(gear, /if \(found != root\) bone = found/);
    assert.match(gear, /if \(!bone\) return null; \/\/ no matched bone/);
    assert.match(gear, /if \(!socket\) return null/);
    assert.doesNotMatch(gear, /if \(!socket\) socket = body\.transform/);
    assert.match(gear, /FromToRotation\(from, boneLocal\)/);
    assert.match(gear, /boneLocal \* 0\.08f/);
    // The hero/NPC blade follows the same rule — never gripped to the root transform.
    assert.match(person, /void GripSwordOrEmptyHands\(\)/);
    assert.match(person, /if \(rightHand && rightHand != transform\)/);
    assert.doesNotMatch(person, /\? rightHand : transform\)/);
    assert.doesNotMatch(person, /\? p\.rightHand : p\.transform\)/);
  });

  it("kernel combat:kill presents a Hub mourn, not a flower-law flee", () => {
    const life = src("NpcLife.cs");
    const client = src("ConcordClient.cs");
    assert.match(life, /NoteKernelDeath/);
    assert.match(life, /NoteKernelThreat/);
    assert.match(life, /act = "mourn"/);
    assert.match(life, /stands with the fallen/);
    assert.match(life, /steelLive\) return false/);
    assert.match(client, /NpcLife\.NoteKernelDeath/);
    assert.match(client, /NpcLife\.NoteKernelThreat/);
    assert.match(client, /combat:kill/);
  });

  it("Hub night has point lanterns, dimmed sun including ContinentSun, compact HUD", () => {
    const look = src("HubLook.cs");
    const book = src("WorldBook.cs");
    const hud = src("ConcordiaHUD.cs");
    const aaa = src("WorldAaa.cs");
    const builder = src("WorldBuilder.cs");
    const compiler = src("CreatureCompiler.cs");
    // Night lighting moved from WorldBook into HubLook.ApplyHour (P0-4 honest night,
    // then the Sep-22 Aura relight): one chosen key (exact "Sun", else any "*sun*"
    // such as ContinentSun) dimmed by Sun01, Fill/Rim kept separate, point lamps
    // brighten as the sun sets. God-rays were removed from the plaza outright.
    assert.match(look, /l\.type = LightType\.Point/);
    assert.match(book, /HubLook\.ApplyHour\(World, Hour\)/);
    assert.match(look, /l\.name\.IndexOf\("sun", System\.StringComparison\.OrdinalIgnoreCase\)/);
    assert.match(look, /l\.name == "Fill" \|\| l\.name == "Rim"/);
    assert.match(look, /l\.type == LightType\.Point && \(l\.name == "CourtLamp"/);
    assert.match(look, /l\.name\.Contains\("Lantern"\)/);
    assert.match(look, /l\.intensity = Mathf\.Lerp\(1\.2f, 0\.35f, sun01\)/);
    assert.match(look, /sky\.SetFloat\("_Exposure", Mathf\.Lerp\(/);
    assert.match(look, /postExposure\.Override\(Mathf\.Lerp\(nightExp, dayExp, sun01\)\)/);
    assert.match(look, /fogColor = Color\.Lerp\(fogNight, fogDay, sun01\)/);
    assert.doesNotMatch(src("HubPlaza.cs"), /GodRays/);
    assert.match(aaa, /DebugDump/);
    assert.match(hud, /KeyCode\.F1/);
    assert.match(hud, /concordia-p0-no-debug/);
    assert.match(hud, /WorldAaa\.DebugDump/);
    // Crowd size is host-budgeted (LeanPlay thins it), but the ring is never empty.
    assert.match(builder, /int walkers = ConcordiaHost\.CrowdWalkers;/);
    assert.match(builder, /for \(int i = 0; i < walkers; i\+\+\)/);
    assert.match(src("ConcordiaHost.cs"), /CrowdWalkers => LeanPlay \? [1-9]\d* : [1-9]\d*/);
    assert.match(compiler, /class FlockOrbit/);
  });

  it("Soldier.glb is the WebGL last-resort mesh; Mixamo never grips the root; night sky dims", () => {
    const person = src("ModularPerson.cs");
    const game = src("ConcordiaGame.cs");
    const aaa = src("WorldAaa.cs");
    const mix = src("MixamoAvatar.cs");
    const packs = src("FreePacks.cs");
    const boot = readFileSync(join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Editor/ConcordiaBoot.cs"), "utf8");
    const web = readFileSync(join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Editor/ConcordiaWebExport.cs"), "utf8");
    const shot = src("ConcordiaShot.cs");
    assert.match(person, /Never Mixamo Soldier/);
    assert.doesNotMatch(person, /LoadAssetAtPath.*Soldier\.glb/);
    // Soldier is no longer a body fallback at all: the person pool is CX prefabs,
    // then Rocketbox. (P0 pass: "No soldier.") The mesh is still in git for Mixamo clips.
    assert.doesNotMatch(person, /Resources\.Load<GameObject>\("Concordia\/Soldier"\)/);
    assert.match(person, /CX_Humanoid_Male\.prefab/);
    assert.match(aaa, /Soldier\.glb in git/);
    assert.doesNotMatch(aaa, /not in git/);
    assert.match(game, /No soldier\./);
    assert.doesNotMatch(game, /not in git/);
    assert.match(mix, /CharacterGear\.Grip/);
    assert.doesNotMatch(mix, /rightHand : root\.transform/);
    assert.match(packs, /fi_vil_wall01_01/);
    assert.match(packs, /fi_vil_pillar8_02/);
    assert.match(boot, /concordia-request-webgl-export/);
    assert.match(boot, /concordia-request-stop/);
    assert.match(web, /Application\.isBatchMode/);
    assert.match(web, /Export WebGL \(in Editor\)/);
    assert.match(web, /public static bool Busy/);
    assert.match(boot, /ConcordiaWebExport\.Busy/);
    assert.match(shot, /concordia-play-night/);
    assert.match(shot, /WorldClock\.Hour = 1\.92f/);
    assert.match(shot, /WaitForSecondsRealtime/);
    assert.doesNotMatch(shot, /new WaitForSeconds\(/);
  });

  it("Kenney magenta shirts are a fallback mesh that gets repainted, not left hot-pink", () => {
    const packs = src("FreePacks.cs");
    const person = src("ModularPerson.cs");
    assert.match(packs, /IsMissingMagenta/);
    assert.match(packs, /c\.r > 0\.7f && c\.b > 0\.7f && c\.g < 0\.35f/);
    assert.match(packs, /PaintMagentaIfFallback/);
    assert.match(person, /PaintMagentaIfFallback\(gameObject, a\.ShirtColor\(\)\)/);
  });

  it("Founding Day persist is player_quests via quests.accept, offer only gather", () => {
    const game = src("ConcordiaGame.cs");
    const log = src("HubObjectives.cs");
    const client = src("ConcordClient.cs");
    assert.match(game, /TryOfferHubQuest\("founding_day_01_gather"\)/);
    assert.doesNotMatch(game, /founding_day_02_reading/);
    assert.doesNotMatch(game, /founding_day_03_sign/);
    assert.match(log, /AcceptQuest\(WorldBook\.Folder\(world\), q\.id\)/);
    assert.match(client, /LensRun\("quests", "accept"/);
    assert.match(client, /VoiceJoin/);
    assert.match(client, /concordia:" \+ world/);
    assert.match(client, /voice_unavailable/);
  });
});
