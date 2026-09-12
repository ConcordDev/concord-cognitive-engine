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
    assert.match(person, /_clipsFit = !_biped &&/);
    assert.match(person, /_plantFrames == 6/);
    assert.match(person, /SoldierLocomotion/);
    assert.match(person, /leftHand = rightHand = body\.transform/);
    assert.match(player, /avatar\?\.SetGait/);
    assert.match(player, /person\?\.SetGait/);
    assert.match(player, /wish\.normalized \* 12\.4f/);
    assert.match(mixamo, /animator\.enabled = grounded/);
    assert.match(life, /SetGait\([^;]+,\s*true\)/);
    assert.match(life, /WorldClock\.NoteAct/);
    assert.match(gear, /if \(!socket\) socket = body\.transform/);
    assert.match(gear, /FromToRotation/);
    assert.match(gate, /class CourtBird/);
    assert.match(gate, /CreatePrimitive\(PrimitiveType\.Sphere\)/);
    assert.match(gate, /CreatePrimitive\(PrimitiveType\.Cube\)/);
    assert.match(builder, /Dove/);
    assert.match(builder, /AddComponent<CourtBird>/);
    assert.match(evo, /"wolf" or "hound" => "Fox"/);
    assert.match(evo, /"griffin" => "Horse"/);
    assert.match(evo, /CreatePrimitive\(KindPrim\(kind\)\)/);
  });
});
