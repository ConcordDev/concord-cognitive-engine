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

describe("Concordia player life — a body, a day, other minds", () => {
  it("SoftEnter walk uses RegionAt so mid-ring stays Hub-overland", () => {
    const stream = src("ContinentStream.cs");
    const map = src("MegaworldMap.cs");
    const tick = stream.slice(stream.indexOf("public void Tick"), stream.indexOf("public void Teleport"));
    assert.match(map, /ArriveM = 68f/);
    assert.match(map, /static WorldId RegionAt\(/);
    assert.match(map, /static float PlanarSqr\(/);
    assert.match(tick, /ReceiveHere\(player\)/);
    assert.doesNotMatch(tick, /SoftEnter\(MegaworldMap\.Toward/);
    const recv = tick.indexOf("ReceiveHere(player)");
    const ensure = tick.indexOf("foreach (var id in MegaworldMap.All)");
    assert.ok(recv >= 0 && ensure >= 0 && recv < ensure, "ReceiveHere must run before chunk Ensure");
    const here = stream.slice(stream.indexOf("public void ReceiveHere"), stream.indexOf("public void SoftEnter"));
    assert.match(here, /MegaworldMap\.RegionAt/);
    assert.match(here, /SoftEnter\(next\)/);
    assert.match(here, /RoadWorld\.TickNear/);
    assert.match(map, /static WorldId Toward\(/);
    assert.match(stream, /ReceiveTraveler\(/);
    assert.match(stream, /You left Hub for/);
    assert.match(stream, /You came home from/);
    assert.match(stream, /void LateUpdate\(\)/);
    const game = src("ConcordiaGame.cs");
    const upd = game.slice(game.indexOf("void Update()"), game.indexOf("string TryInteract"));
    assert.match(upd, /ContinentStream\.Live\?\.Tick/);
    assert.match(upd, /WorldClock\.Tick/);
    const creatorGate = upd.indexOf("CharacterCreator.IsOpen");
    const tickAt = upd.indexOf("ContinentStream.Live?.Tick");
    assert.ok(tickAt >= 0 && (creatorGate < 0 || tickAt < creatorGate));
  });

  it("LivingBody is a component on the hero, cook eats, wall climb", () => {
    const body = src("LivingBody.cs");
    const player = src("ConcordiaPlayer.cs");
    const motor = src("AgentMotor.cs");
    const cook = src("WorldGate.cs");
    const clock = src("WorldBook.cs");
    const hud = src("ConcordiaHUD.cs");
    assert.match(body, /class LivingBody : MonoBehaviour/);
    assert.match(body, /BindHero/);
    assert.match(body, /dt \* 0\.08f/);
    assert.match(body, /NeedLine/);
    assert.match(body, /Hunger >= 0\.18f/);
    assert.match(body, /hour - 5\.5f/);
    assert.match(body, /You are /);
    assert.match(player, /AddComponent<LivingBody>/);
    assert.match(player, /LivingBody\.Hero\.Tick/);
    assert.match(player, /CollisionFlags\.Sides/);
    assert.match(player, /LivingBody\.Hero\.Climb/);
    assert.match(player, /ReceiveHere\(transform\.position\)|ReceiveLand\(\)/);
    assert.match(player, /public void Stand\(/);
    assert.match(player, /public string LandLine/);
    assert.match(player, /WalkBearing\(/);
    assert.match(player, /NeedLine/);
    assert.match(player, /KitBag\.HasLoot/);
    const canon = src("Canon.cs");
    assert.match(canon, /OnSunderingLane\(/);
    assert.match(canon, /5\.4f/);
    assert.doesNotMatch(canon, /Spawn = new Vector3\(0, 0, -11\)/);
    const builder = src("WorldBuilder.cs");
    assert.match(builder, /OnSunderingLane/);
    assert.match(motor, /AddComponent<LivingBody>/);
    assert.match(motor, /_life\.MoveMul/);
    assert.match(cook, /LivingBody\.Hero\?\.Eat\(\)/);
    assert.match(clock, /You remember:/);
    assert.match(clock, /JourneyLine/);
    assert.match(clock, /!JourneyLine\(LastEvent\)/);
    assert.match(hud, /body \? body\.NeedLine/);
    assert.match(hud, /player\.LandLine/);
    assert.match(player, /land /);
    assert.match(player, /MegaworldMap\.RegionAt/);
    assert.match(player, /clock /);
  });

  it("crowd can hail the player; road walkers exist", () => {
    const life = src("NpcLife.cs");
    const guest = src("WorldGate.cs");
    const stream = src("ContinentStream.cs");
    const host = src("ConcordiaHost.cs");
    const game = src("ConcordiaGame.cs");
    assert.match(life, /TryHailPlayer\(/);
    assert.match(life, /hailed = true/);
    assert.match(guest, /public bool hailed/);
    assert.match(guest, /hailed you/);
    assert.match(game, /npc\.hailed = false/);
    assert.match(game, /Bonds\.TalkBump/);
    assert.match(game, /if \(!_player\) _player = ConcordiaPlayer.Live/);
    assert.match(host, /RoadWalkers/);
    assert.match(stream, /RoadWorld\.Seed\(/);
    assert.match(stream, /RoadWorld\.PlaceSign\(/);
    const road = src("RoadWorld.cs");
    assert.match(road, /RoleFor\(/);
    assert.match(road, /Iron Warden/);
    assert.doesNotMatch(road, /displayName = "Traveler"/);
  });

  it("bible names the player-life bar", () => {
    const sheet = readFileSync(join(bible, "PLAYER_LIFE.md"), "utf8");
    const readme = readFileSync(join(bible, "README.md"), "utf8");
    assert.match(sheet, /visitor with cheats/);
    assert.match(sheet, /RegionAt/);
    assert.match(sheet, /LivingBody/);
    assert.match(sheet, /Present receive is the gate/);
    assert.match(readme, /PLAYER_LIFE/);
  });
});
