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

describe("Concordia road wilderness — threat, discovery, whole Ring", () => {
  it("mid-ring seeds wrecks, watchers, delves, and wayfinding signs", () => {
    const road = src("RoadWorld.cs");
    const stream = src("ContinentStream.cs");
    const host = src("ConcordiaHost.cs");
    assert.match(stream, /RoadWorld\.Seed\(/);
    assert.match(stream, /RoadWorld\.PlaceSign\(/);
    assert.match(road, /this way /);
    assert.match(road, /steel ahead/);
    assert.match(road, /Present close/);
    assert.match(road, /TickNear\(/);
    assert.match(road, /NearLine/);
    assert.match(road, /characterSize = 0\.16f/);
    assert.match(stream, /RoadWorld\.TickNear/);
    assert.match(road, /ConcordiaPlayer\.Live/);
    assert.match(road, /Wreck_/);
    assert.match(road, /Watcher_/);
    assert.match(road, /Delve_/);
    assert.match(road, /camp cache/);
    assert.match(road, /DropSpoils\(/);
    assert.match(road, /road spoils/);
    assert.match(host, /RoadThreats/);
    assert.match(host, /RoadDelves/);
    assert.match(host, /LeanPlay \? 4 : 8/);
    assert.match(host, /LeanPlay \? 2 : 8/);
  });

  it("Sundering is seeded first; travelers have jobs, not a generic Traveler", () => {
    const road = src("RoadWorld.cs");
    assert.match(road, /static readonly int\[\] WalkerOrder = \{ 2, 4, 3, 5, 1, 6, 0, 7 \}/);
    assert.match(road, /Iron Warden/);
    assert.match(road, /Grove merchant/);
    assert.match(road, /Scout/);
    assert.match(road, /Fixer/);
    assert.match(road, /Uncounted runner/);
    assert.match(road, /Glyph keeper/);
    assert.match(road, /Dawn watcher/);
    assert.match(road, /Lattice walker/);
    assert.match(road, /NpcLife\.Job\.Watch/);
    assert.doesNotMatch(road, /displayName = "Traveler"/);
    assert.doesNotMatch(road, /MixamoAvatar/);
  });

  it("road fights stay dead on Hub-overland; gym dummy still revives; hostiles gait", () => {
    const dummy = src("TrainingDummy.cs");
    const hostile = src("Hostile.cs");
    const clock = src("WorldBook.cs");
    assert.match(dummy, /bool Gym =>/);
    assert.match(dummy, /KernelAuthored/);
    assert.match(dummy, /GuestLabel/);
    assert.match(dummy, /hostile\.enabled = false/);
    assert.match(dummy, /if \(!Gym\)/);
    assert.match(dummy, /RoadWorld\.DropSpoils/);
    assert.match(dummy, /BindId\(/);
    const gymBranch = dummy.slice(dummy.indexOf("if (!Gym)"), dummy.indexOf("else if (world == WorldId.Hub)"));
    assert.doesNotMatch(gymBranch, /hp = 80/);
    assert.match(dummy, /else if \(world == WorldId\.Hub\)/);
    assert.match(hostile, /_person\?\.SetGait\(speed/);
    assert.match(hostile, /_person\?\.SetGait\(0f/);
    assert.match(clock, /JourneyLine\(LastEvent\)/);
    assert.match(clock, /a pack thinned/);
  });

  it("bible names wilderness and whole Ring as the lived-day bar", () => {
    const sheet = readFileSync(join(bible, "PLAYER_LIFE.md"), "utf8");
    assert.match(sheet, /dangerous, findable world/);
    assert.match(sheet, /Wilderness that pushes back/);
    assert.match(sheet, /Whole Ring, not Fantasy-only/);
    assert.match(sheet, /RoadWorld/);
    assert.match(sheet, /Training Dummy in the Arena is a gym/);
    assert.match(sheet, /this way The Sundering/);
    assert.match(sheet, /Do not run it while world\/clock stay Hub/);
  });
});
