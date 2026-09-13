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
    assert.match(person, /FORCE_REFRESH_0023/);
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
    assert.match(person, /if \(!_clipsFit && _authored/);
    assert.match(person, /ApplyKenneyDoll/);
    assert.doesNotMatch(person, /leftHand = rightHand = body\.transform/);
  });

  it("grip refuses body root and only parents to a Hand bone", () => {
    const gear = src("CharacterGear.cs");
    const person = src("ModularPerson.cs");
    assert.match(gear, /if \(!socket\) return null/);
    assert.match(gear, /if \(!IsHand\(hand\)\) return/);
    assert.match(gear, /hand == hand\.root/);
    assert.match(gear, /IndexOf\("Hand"/);
    assert.match(gear, /return null;/);
    assert.doesNotMatch(gear, /if \(!socket\) socket = body\.transform/);
    assert.doesNotMatch(gear, /return root;/);
    assert.match(gear, /FromToRotation\(from, boneLocal\)/);
    assert.match(gear, /boneLocal \* 0\.08f/);
    assert.match(person, /p\.rightHand && p\.rightHand != p\.transform/);
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
    assert.match(look, /l\.type = LightType\.Point/);
    assert.match(look, /"LanternLight"/);
    assert.match(book, /l\.name == "Sun"/);
    assert.match(book, /sun\.intensity = \(0\.92f \+ 0\.38f \* day\)/);
    assert.match(book, /ContinentSun/);
    assert.match(book, /day < 0\.32f/);
    assert.match(book, /LanternLight/);
    assert.match(aaa, /DebugDump/);
    assert.match(hud, /KeyCode\.F1/);
    assert.match(hud, /concordia-p0-no-debug/);
    assert.match(hud, /WorldAaa\.DebugDump/);
    assert.match(builder, /for \(int i = 0; i < 24; i\+\+\)/);
    assert.match(compiler, /class FlockOrbit/);
  });
});
