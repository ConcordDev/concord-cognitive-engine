import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");
const ticket = join(root, "docs/CONCORDIA_PLAYABLE_SLICE.md");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia Playable Slice — ticket lock", () => {
  it("the slice ticket exists and names captures + ban list", () => {
    assert.equal(existsSync(ticket), true);
    const t = readFileSync(ticket, "utf8");
    assert.match(t, /Playable Alive Slice/);
    assert.match(t, /ConcordiaLocomotion/);
    assert.match(t, /zero LateUpdate bone hinging/);
    assert.match(t, /ps-walk-cycle/);
    assert.match(t, /ps-jump/);
    assert.match(t, /ps-npc-pathing/);
    assert.match(t, /ps-hub-day/);
    assert.match(t, /ps-hub-night/);
    assert.match(t, /ps-grip/);
    assert.match(t, /ps-birds/);
    assert.match(t, /ps-fauna/);
    assert.match(t, /ps-npc-react/);
    assert.match(t, /Ban list/);
    assert.match(t, /no new megaworld/);
    assert.match(t, /chronicle schema/);
    assert.match(t, /affinity copy/);
    assert.match(t, /BipedHinge/);
    assert.match(t, /Living Birds/);
    assert.match(t, /CourtBird/);
    assert.match(t, /causal chain/);
    assert.match(t, /server\/tests\/concordia-playable-slice\.test\.js/);
  });

  it("Unity build plan and Next Arc point at the slice gate", () => {
    const build = readFileSync(join(root, "docs/CONCORDIA_UNITY_BUILD_PLAN.md"), "utf8");
    const arc = readFileSync(join(root, "docs/NEXT_ARC_PLAN.md"), "utf8");
    assert.match(build, /CONCORDIA_PLAYABLE_SLICE/);
    assert.match(build, /Playable Alive Slice/);
    assert.match(arc, /CONCORDIA_PLAYABLE_SLICE/);
    assert.match(arc, /no new megaworld/);
    assert.match(arc, /Playable Alive Slice/);
  });

  it("live body still uses the puppet path this ticket bans (honest until green)", () => {
    const person = src("ModularPerson.cs");
    const player = src("ConcordiaPlayer.cs");
    const mixamo = src("MixamoAvatar.cs");
    const life = src("NpcLife.cs");
    const gear = src("CharacterGear.cs");
    const gate = src("WorldGate.cs");
    const builder = src("WorldBuilder.cs");
    const evo = src("EvoSpawner.cs");
    assert.match(person, /BipedHinge\(/);
    assert.match(person, /ApplyAuthoredGait\(/);
    // Humanoid clips on any valid avatar, Bip01 included (measured 2026-09-20 —
    // see ModularPerson: "do not reintroduce a !_biped exclusion").
    assert.match(person, /_clipsFit = ctrl && av && av\.isHuman && av\.isValid/);
    assert.doesNotMatch(person, /_clipsFit = !_biped &&/);
    // Authored feet plant over the first frames after bind (window widened Sep 22).
    assert.match(person, /_authored && _plantFrames < \d+/);
    assert.match(person, /SoldierLocomotion/);
    // Rigless body = empty hands (null), never the body transform as a fake hand.
    assert.match(person, /leftHand = rightHand = null/);
    assert.doesNotMatch(person, /leftHand = rightHand = body\.transform/);
    assert.match(player, /avatar\?\.SetGait/);
    assert.match(player, /person\?\.SetGait/);
    assert.match(player, /AddVelocity\(\(wish\.sqrMagnitude > 0\.01f \? wish\.normalized : transform\.forward\) \* 12\.4f\)/);
    // Airborne no longer freezes the rig (Sep 13 gait pass): Speed is zeroed off-ground
    // and Grounded is fed to the controller instead.
    assert.match(mixamo, /if \(grounded && speed > 0\.35f\)/);
    assert.match(mixamo, /SetBool\("Grounded", grounded\)/);
    assert.match(life, /SetGait\([^;]+,\s*true\)/);
    assert.match(life, /WorldClock\.NoteAct/);
    // No root fallback: no matched socket means empty hands (see alive-gate grip test).
    assert.match(gear, /if \(!socket\) return null/);
    assert.doesNotMatch(gear, /if \(!socket\) socket = body\.transform/);
    assert.match(gear, /FromToRotation/);
    assert.match(gate, /class CourtBird/);
    assert.match(gate, /CreatePrimitive\(PrimitiveType\.Sphere\)/);
    assert.match(gate, /CreatePrimitive\(PrimitiveType\.Cube\)/);
    assert.match(builder, /hub-flock-/);
    assert.match(builder, /CreatureCompiler\.Compile/);
    assert.match(evo, /CreatureCompiler\.FromCritter/);
    assert.match(evo, /CreatureCompiler\.FromKind/);
    assert.doesNotMatch(evo, /"wolf" or "hound" => "Fox"/);
    assert.doesNotMatch(evo, /"griffin" => "Horse"/);
  });
});
