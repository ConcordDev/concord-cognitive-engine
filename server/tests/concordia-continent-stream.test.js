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

  it("ContinentStream is the live Travel path — Build is boot only", () => {
    const stream = src("ContinentStream.cs");
    const game = src("ConcordiaGame.cs");
    const builder = src("WorldBuilder.cs");
    assert.match(stream, /TravelMode = "continent_stream"/);
    assert.match(stream, /StreamInM = 175f/);
    assert.match(stream, /StreamOutM = 360f/);
    assert.match(stream, /HubKeepM = 125f/);
    assert.match(stream, /L3NearM = 55f/);
    assert.match(stream, /static int LodOf\(/);
    assert.match(stream, /EnsureImpostor\(/);
    assert.match(builder, /BuildImpostor\(/);
    assert.match(builder, /Impostor_/);
    assert.match(stream, /link_gate/);
    assert.match(stream, /void Tick\(/);
    assert.match(builder, /BuildChunk\(/);
    assert.match(builder, /ContinentStream\.Bind/);
    assert.match(game, /ContinentStream\.Bind\(_world\)/);
    assert.match(game, /stream\.Teleport/);
    assert.match(game, /ContinentStream\.Live\?\.Tick/);
    assert.doesNotMatch(game, /_world\.Build\(next\)/);
    assert.match(game, /refusing single-world Build/);
    assert.match(game, /NoteWorld\(/);
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
    assert.doesNotMatch(builder, /FreePacks\.Bird\(/);
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

  it("StreamOut clears the civilization ring so Hub sees impostors", () => {
    const stream = src("ContinentStream.cs");
    const map = src("MegaworldMap.cs");
    const inM = Number(stream.match(/StreamInM = ([0-9.]+)f/)[1]);
    const outM = Number(stream.match(/StreamOutM = ([0-9.]+)f/)[1]);
    const km = Number(map.match(/CivilizationRadiusKm = ([0-9.]+)f/)[1]);
    const mPerKm = Number(map.match(/PresentMetersPerKm = ([0-9.]+)f/)[1]);
    const ring = km * mPerKm;
    const sere = ring * 1.35;
    assert.ok(outM > sere, `StreamOutM ${outM} must clear Sere at ${sere}`);
    assert.ok(inM < ring, `StreamInM ${inM} must not load every civ from Hub at ${ring}`);
    assert.ok(inM > 150, `StreamInM ${inM} must load a chunk before the player is on top of it`);
  });

  it("SoftEnter writes player.world; walk-out uses RegionAt not Toward", () => {
    const stream = src("ContinentStream.cs");
    const map = src("MegaworldMap.cs");
    const canon = src("Canon.cs");
    const gate = src("WorldGate.cs");
    const plaza = src("HubPlaza.cs");
    const presence = src("WorldPresence.cs");
    const worldGate = src("WorldGate.cs");
    const tick = stream.slice(stream.indexOf("public void Tick"), stream.indexOf("public void Teleport"));
    assert.match(stream, /player\.world = id/);
    assert.match(tick, /ReceiveHere\(player\)/);
    assert.doesNotMatch(tick, /SoftEnter\(MegaworldMap\.Toward/);
    const recvAt = tick.indexOf("ReceiveHere(player)");
    const loopAt = tick.indexOf("foreach (var id in MegaworldMap.All)");
    assert.ok(recvAt >= 0 && loopAt >= 0 && recvAt < loopAt, "ReceiveHere before Ensure loop");
    assert.match(tick, /MegaworldMap\.Toward\(player\)/);
    assert.match(tick, /ConcordiaHost\.LeanPlay/);
    assert.match(map, /static WorldId RegionAt\(/);
    assert.match(map, /ArriveM = 68f/);
    assert.match(map, /static float PlanarSqr\(/);
    assert.match(stream, /public void ReceiveHere\(/);
    assert.match(stream, /Canon\.InHubCourt/);
    assert.match(stream, /MakeWilderness\(/);
    assert.match(src("WorldBuilder.cs"), /ContinentStream\.Live \? 0\.0026f : 0\.0045f/);
    assert.match(stream, /ContinentWilderness/);
    assert.match(map, /static WorldId Toward\(/);
    assert.match(canon, /HubLawRadius = 42f/);
    assert.match(canon, /static bool InHubCourt\(/);
    assert.match(canon, /return !InHubCourt\(p\)/);
    assert.match(gate, /OnTriggerEnter/);
    assert.match(gate, /game\.Travel\(def\.world\)/);
    assert.match(plaza, /FallbackArch\(/);
    assert.match(plaza, /ThinArch\(/);
    assert.match(plaza, /Missing_/);
    assert.match(plaza, /AddComponent<WorldGate>\(\)\.def = gate/);
    const builder = src("WorldBuilder.cs");
    assert.match(builder, /outDir \* 16f/);
    assert.match(builder, /KeepRingClear\(/);
    assert.doesNotMatch(builder, /StampRingLink/);
    assert.doesNotMatch(builder, /LinkMouth_/);
    assert.match(stream, /FindObjectsByType<ConcordiaPlayer>/);
    assert.match(stream, /FindObjectsInactive\.Include/);
    assert.match(stream, /public void SoftEnter\(/);
    assert.match(stream, /static void SyncActor\(/);
    assert.match(src("ConcordiaGame.cs"), /5\.2f/);
    assert.match(src("WorldGate.cs"), /right \* \(i == 0 \? -3\.4f : 3\.4f\)/);
    assert.match(presence, /FindGuest\(/);
    assert.match(presence, /GateToward\(/);
    assert.match(presence, /ContinentStream\.Live/);
    assert.doesNotMatch(worldGate, /public static class WorldPresence/);
    assert.equal((worldGate.match(/class WorldPresence/g) || []).length, 0);
    assert.equal((presence.match(/class WorldPresence/g) || []).length, 1);
  });

  it("SoftEnter writes ConcordiaPlayer.world before the WorldClock already-there return", () => {
    const stream = src("ContinentStream.cs");
    const soft = stream.slice(stream.indexOf("public void SoftEnter"), stream.indexOf("static void SyncActor"));
    assert.match(soft, /SyncActor\(id\)/);
    const syncFirst = soft.indexOf("SyncActor(id)");
    const clockReturn = soft.indexOf("WorldClock.World == id");
    assert.ok(syncFirst >= 0 && clockReturn > syncFirst, "SyncActor must run even when the clock already matches (Editor SoftEnter proof)");
    assert.match(stream, /FindObjectsByType<ConcordiaPlayer>/);
    assert.match(stream, /player\.world = id/);
    assert.match(stream, /EquipWorldKit\(\)/);
  });

  it("Travel always Bind()s the stream so a disabled component cannot drop the player at SteelSpawn", () => {
    const game = src("ConcordiaGame.cs");
    assert.match(game, /ContinentStream\.Bind\(_world\)/);
    assert.match(game, /stream\.Teleport/);
    assert.doesNotMatch(game, /if \(ContinentStream\.Live != null\)/);
    assert.doesNotMatch(game, /_world\.Build\(next\)/);
    assert.match(game, /refusing single-world Build/);
  });

  it("Hub Ring stays loaded across Travel; walking SoftEnter is not stuck on link_gate", () => {
    const stream = src("ContinentStream.cs");
    const tick = stream.slice(stream.indexOf("public void Tick"), stream.indexOf("public void Teleport"));
    assert.match(tick, /Ensure\(WorldId\.Hub\)/);
    assert.doesNotMatch(tick, /Release\(WorldId\.Hub\)/);
    assert.match(stream, /SoftEnter\(next, "link_gate"\)/);
    assert.match(stream, /public void SoftEnter\(WorldId id, string kind = "walk"\)/);
    assert.match(stream, /LastTravelKind = kind/);
    assert.doesNotMatch(stream, /LastTravelKind == "link_gate" \? "link_gate"/);
    assert.match(stream, /game\.NoteWorld\(id\)/);
    const game = src("ConcordiaGame.cs");
    assert.match(game, /ConcordClient\.JoinWorld\(WorldBook\.Folder/);
    assert.doesNotMatch(game, /if \(client && client\.Connected\)/);
    const client = src("ConcordClient.cs");
    assert.match(client, /public static Task JoinWorld/);
    assert.match(client, /if \(!Connected\)/);
    assert.match(client, /EnsureConnected\(\)/);
    assert.match(client, /_retryAt = Time\.unscaledTime \+ 8f/);
  });

  it("ContinentStream.Live survives OnDisable so Travel cannot lose the stream mid-session", () => {
    const stream = src("ContinentStream.cs");
    assert.match(stream, /void OnEnable\(\)/);
    assert.match(stream, /void OnDestroy\(\)[\s\S]*if \(Live == this\) Live = null/);
    const onDestroy = stream.indexOf("void OnDestroy()");
    const liveClear = stream.indexOf("if (Live == this) Live = null");
    assert.ok(onDestroy >= 0 && liveClear > onDestroy, "Live=null belongs on OnDestroy, not OnDisable");
    assert.doesNotMatch(stream, /void OnDisable\(\)/);
  });

  it("bible status matches the live path", () => {
    const streaming = readFileSync(join(root, "apps/concordia-living-world/bible/STREAMING.md"), "utf8");
    const creatures = readFileSync(join(root, "apps/concordia-living-world/bible/CREATURES.md"), "utf8");
    assert.match(streaming, /LIVE \(continent stream/);
    assert.match(streaming, /ContinentStream/);
    assert.match(streaming, /L0 unload/);
    assert.match(streaming, /L1 impostor/);
    assert.match(streaming, /SyncActor/);
    assert.match(streaming, /Bind/);
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
