import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts");

function src(name) {
  return readFileSync(join(scripts, name), "utf8");
}

describe("Concordia continent streaming + creature compiler", () => {
  it("MegaworldMap matches Canon gate angles and compresses 400km to walkable metres", () => {
    const map = src("MegaworldMap.cs");
    const canon = src("Canon.cs");
    assert.match(map, /CivilizationRadiusKm = 400f/);
    assert.match(map, /PresentMetersPerKm = 0.55f/);
    assert.match(map, /WorldId\.Sere/);
    assert.match(canon, /angle = Mathf\.PI \/ 2/);
    assert.match(map, /Canon\.Gates/);
  });

  it("ContinentStream is the live Travel path — no region_rebuild", () => {
    const stream = src("ContinentStream.cs");
    const game = src("ConcordiaGame.cs");
    const builder = src("WorldBuilder.cs");
    assert.match(stream, /TravelMode = "continent_stream"/);
    assert.match(stream, /StreamInM = 95f/);
    assert.match(stream, /StreamOutM = 145f/);
    assert.match(stream, /L3NearM = 40f/);
    assert.match(stream, /static int LodOf\(/);
    assert.match(stream, /EnsureImpostor\(/);
    assert.match(builder, /BuildImpostor\(/);
    assert.match(builder, /Impostor_/);
    assert.match(stream, /link_gate/);
    assert.match(stream, /void Tick\(/);
    assert.match(builder, /BuildChunk\(/);
    assert.match(builder, /ContinentStream\.Bind/);
    assert.match(game, /ContinentStream\.Live\?\.Teleport/);
    assert.match(game, /ContinentStream\.Live\?\.Tick/);
    assert.doesNotMatch(game, /_world\.Build\(next\)/);
  });

  it("CreatureCompiler is honest — no Fox-for-wolf, no primitive CourtBird Hub flock", () => {
    const compiler = src("CreatureCompiler.cs");
    const evo = src("EvoSpawner.cs");
    const builder = src("WorldBuilder.cs");
    assert.match(compiler, /class CreatureCompiler/);
    assert.match(compiler, /StemFor\(/);
    assert.match(compiler, /wolf/);
    assert.match(compiler, /return ""/);
    assert.doesNotMatch(compiler, /wolf.*=.*"Fox"/);
    assert.doesNotMatch(compiler, /griffin.*=.*"Horse"/);
    assert.doesNotMatch(compiler, /harpy.*=.*"Parrot"/);
    assert.match(evo, /CreatureCompiler\.FromKind/);
    assert.match(evo, /CreatureCompiler\.FromCritter/);
    assert.doesNotMatch(evo, /"wolf" or "hound" => "Fox"/);
    assert.doesNotMatch(evo, /CreatePrimitive\(KindPrim/);
    assert.match(builder, /DressVocab\.Bird\(\)/);
    assert.match(builder, /CreatureCompiler\.FromKind/);
    assert.match(builder, /FlockOrbit/);
    assert.doesNotMatch(builder, /Dove" \+/);
    assert.doesNotMatch(builder, /AddComponent<CourtBird>/);
    assert.match(compiler, /class FlockOrbit/);
    assert.match(compiler, /PresentKernel/);
  });

  it("LodOf pins L0–L3 thresholds", () => {
    const stream = src("ContinentStream.cs");
    assert.match(stream, /if \(dist >= StreamOutM\) return 0/);
    assert.match(stream, /if \(dist > StreamInM\) return 1/);
    assert.match(stream, /if \(dist > L3NearM\) return 2/);
    assert.match(stream, /return 3/);
  });

  it("bible status matches the live path", () => {
    const streaming = readFileSync(join(root, "apps/concordia-living-world/bible/STREAMING.md"), "utf8");
    const creatures = readFileSync(join(root, "apps/concordia-living-world/bible/CREATURES.md"), "utf8");
    assert.match(streaming, /LIVE \(continent stream/);
    assert.match(streaming, /ContinentStream/);
    assert.match(streaming, /L0 unload/);
    assert.match(streaming, /L1 impostor/);
    assert.match(creatures, /CreatureCompiler/);
    assert.match(creatures, /wolf is not a Fox/);
  });

  it("script files exist", () => {
    for (const name of ["MegaworldMap.cs", "ContinentStream.cs", "CreatureCompiler.cs", "WorldPresence.cs"]) {
      assert.equal(existsSync(join(scripts, name)), true, name);
    }
  });

  it("WorldPresence is one type — guests, gates, and chunk coverage live together", () => {
    const presence = src("WorldPresence.cs");
    const gate = src("WorldGate.cs");
    assert.match(presence, /public static class WorldPresence/);
    assert.match(presence, /FindGuest\(/);
    assert.match(presence, /GateToward\(/);
    assert.match(presence, /ContinentStream\.Live/);
    assert.match(presence, /Canon\.RingRadius/);
    assert.doesNotMatch(gate, /public static class WorldPresence/);
  });

  it("stacked-merge collisions stay closed (one BindGenome, one TelegraphKind)", () => {
    const fauna = src("EvoSpawner.cs");
    const hostile = src("Hostile.cs");
    const builder = src("WorldBuilder.cs");
    const clock = src("WorldBook.cs");
    assert.equal((fauna.match(/public void BindGenome\(/g) || []).length, 1);
    assert.equal((hostile.match(/public static string TelegraphKind/g) || []).length, 1);
    assert.match(builder, /DressVocab\.Bird\(\)/);
    assert.doesNotMatch(builder, /FreePacks\.Bird\(/);
    assert.match(clock, /public static void RefreshSky\(\)/);
    assert.match(clock, /0\.22f \+ 0\.98f \* sun01/);
    assert.doesNotMatch(clock, /0\.98f \* day/);
  });
});
