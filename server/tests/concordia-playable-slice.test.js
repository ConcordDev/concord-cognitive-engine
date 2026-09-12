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
    assert.match(t, /Playable Slice/);
    assert.match(t, /ConcordiaLocomotion/);
    assert.match(t, /zero LateUpdate bone hinging/);
    assert.match(t, /ps-walk-cycle/);
    assert.match(t, /ps-jump/);
    assert.match(t, /ps-npc-pathing/);
    assert.match(t, /ps-hub-day/);
    assert.match(t, /ps-hub-night/);
    assert.match(t, /Ban list/);
    assert.match(t, /no new megaworld/);
    assert.match(t, /BipedHinge/);
    assert.match(t, /server\/tests\/concordia-playable-slice\.test\.js/);
  });

  it("Unity build plan and Next Arc point at the slice gate", () => {
    const build = readFileSync(join(root, "docs/CONCORDIA_UNITY_BUILD_PLAN.md"), "utf8");
    const arc = readFileSync(join(root, "docs/NEXT_ARC_PLAN.md"), "utf8");
    assert.match(build, /CONCORDIA_PLAYABLE_SLICE/);
    assert.match(build, /Playable Slice/);
    assert.match(arc, /CONCORDIA_PLAYABLE_SLICE/);
    assert.match(arc, /no new megaworld/);
  });

  it("live body still uses the puppet path this ticket bans (honest until green)", () => {
    const person = src("ModularPerson.cs");
    const player = src("ConcordiaPlayer.cs");
    const mixamo = src("MixamoAvatar.cs");
    const life = src("NpcLife.cs");
    assert.match(person, /BipedHinge\(/);
    assert.match(person, /ApplyAuthoredGait\(/);
    assert.match(person, /_clipsFit = !_biped &&/);
    assert.match(person, /_plantFrames == 6/);
    assert.match(person, /SoldierLocomotion/);
    assert.match(player, /avatar\?\.SetGait/);
    assert.match(player, /person\?\.SetGait/);
    assert.match(player, /wish\.normalized \* 12\.4f/);
    assert.match(mixamo, /animator\.enabled = grounded/);
    assert.match(life, /SetGait\([^;]+,\s*true\)/);
  });
});
