import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");
const bible = join(root, "apps/concordia-living-world/bible");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia combat feel — gait, delayed hits, dummy flinch", () => {
  it("CombatMotion Pulse overshoots and Delay is the apex, not the click", () => {
    const motion = src("CombatMotion.cs");
    assert.match(motion, /static float Pulse\(/);
    assert.match(motion, /1\.12f/);
    assert.match(motion, /static float Delay\(/);
    assert.match(motion, /Duration\(heavy, style\) \* 0\.36f/);
    assert.match(motion, /static float ComboOpen\(/);
  });

  it("player queues HitScan at Delay and combos distinct Slash beats", () => {
    const player = src("ConcordiaPlayer.cs");
    assert.match(player, /CombatMotion\.Delay/);
    assert.match(player, /person\?\.Slash\(heavy, beat\)/);
    assert.match(player, /avatar\?\.Slash\(heavy, beat\)/);
    assert.match(player, /_comboBeat/);
    assert.match(player, /_hitstop = 0\.045f/);
    assert.doesNotMatch(
      player.slice(player.indexOf("void TryAttack"), player.indexOf("void TrySpecial")),
      /HitScan\(heavy, 1f\)/,
    );
    assert.match(player, /dummy\.KernelAuthored/);
    assert.match(player, /dummy\.GuestLabel/);
    const motor = src("AgentMotor.cs");
    assert.match(motor, /dummy\.KernelAuthored/);
    assert.match(motor, /dummy\.Hit\(/);
  });

  it("authored gait walks below sprint and consumes Hurt on hips", () => {
    const person = src("ModularPerson.cs");
    assert.match(person, /void Slash\(bool heavy, int beat\)/);
    assert.match(person, /InverseLerp\(6\.2f, 8\.2f, spd\)/);
    assert.match(person, /_phase - 0\.42f/);
    assert.match(person, /void ApplyAuthoredStrike\(/);
    assert.match(person, /CombatMotion\.Pulse/);
    const gait = person.slice(person.indexOf("void ApplyAuthoredGait"), person.indexOf("void ApplyAuthoredAttitude"));
    assert.match(gait, /_hitT -= dt/);
    assert.match(gait, /16f \* hit/);
  });

  it("MixamoAvatar keeps the animator airborne", () => {
    const mix = src("MixamoAvatar.cs");
    assert.match(mix, /animator\.enabled = true/);
    assert.doesNotMatch(mix, /animator\.enabled = grounded/);
    assert.match(mix, /void Slash\(bool heavy, int beat\)/);
  });

  it("dummy and hostiles move their bodies, not only a scale flash", () => {
    const dummy = src("TrainingDummy.cs");
    const hostile = src("Hostile.cs");
    const feel = src("CombatFeel.cs");
    assert.match(dummy, /person\?\.Hurt\(\)/);
    assert.match(dummy, /person\?\.Stagger\(\)/);
    assert.match(hostile, /person\?\.Slash\(\)/);
    assert.match(feel, /person\?\.Hurt\(\)/);
  });

  it("bible names the Biped floor and apex hit", () => {
    const anim = readFileSync(join(bible, "ANIMATION.md"), "utf8");
    const combat = readFileSync(join(bible, "COMBAT.md"), "utf8");
    assert.match(anim, /Rocketbox Biped/);
    assert.match(anim, /CombatMotion/);
    assert.match(combat, /apex/);
    assert.match(combat, /ComboOpen/);
  });
});
