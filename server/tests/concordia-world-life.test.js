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

describe("Concordia world-life — source contracts", () => {
  it("WorldClock ports kernel hours and persist slices, with REAL/BULK/VIRTUAL LOD", () => {
    const book = src("WorldBook.cs");
    assert.match(book, /public static class WorldClock/);
    assert.match(book, /public static class WorldMemory/);
    assert.match(book, /enum SimLod \{ Real, Bulk, Virtual \}/);
    assert.match(book, /dt \* 0\.08f/);
    assert.match(book, /concordia-living-v1\.json/);
    assert.match(book, /The world continued while you were away/);
    assert.doesNotMatch(book, /Concord admits he loves her/);
  });

  it("NpcLife walks sleep/work/eat/gather and flees steel", () => {
    const life = src("NpcLife.cs");
    assert.match(life, /act = "sleep"/);
    assert.match(life, /"work"/);
    assert.match(life, /act = "eat"/);
    assert.match(life, /act = "gather"/);
    assert.match(life, /act = "flee"/);
    assert.match(life, /class BuildingPlace/);
    assert.match(life, /pinned/);
  });

  it("FaunaLife is the live path; EvoDrift is disabled on spawn", () => {
    const evo = src("EvoSpawner.cs");
    assert.match(evo, /class FaunaLife/);
    assert.match(evo, /act = "wander"/);
    assert.match(evo, /act = "graze"/);
    assert.match(evo, /act = "flee"/);
    assert.match(evo, /AddComponent<FaunaLife>/);
    assert.match(evo, /if \(spin\) spin\.enabled = false/);
    assert.match(evo, /WorldMemory\.IsDead/);
  });

  it("Hostile perceives, strafes, and composes with FaunaLife", () => {
    const h = src("Hostile.cs");
    assert.match(h, /_seen/);
    assert.match(h, /_strafe/);
    assert.match(h, /_fauna\.hunting/);
    assert.match(h, /Flower-law|Unburned Court|SteelLive/);
  });

  it("holds are a mouth/hall/vault graph and city ambient stays unlabeled", () => {
    const fill = src("RealmFill.cs");
    assert.match(fill, /Room\(hold,.*mouth/);
    assert.match(fill, /Room\(hold,.*hall/);
    assert.match(fill, /Room\(hold,.*vault/);
    assert.match(fill, /AmbientWalkers/);
    assert.match(fill, /Not an authored citizen/);
    assert.match(fill, /StampSash/);
    assert.match(fill, /No authored dungeon name|not an authored dungeon name/);
    assert.doesNotMatch(fill, /Concord admits he loves her/);
  });

  it("travel persists the slice and the HUD shows the living clock", () => {
    const game = src("ConcordiaGame.cs");
    const hud = src("ConcordiaHUD.cs");
    assert.match(game, /WorldClock\.Leave\(\)/);
    assert.match(game, /WorldClock\.Enter\(/);
    assert.match(game, /WorldClock\.Tick\(/);
    assert.match(game, /NoticePlayer/);
    assert.match(hud, /WorldClock\.HudClock\(\)/);
    assert.match(hud, /WorldClock\.NearbyAct/);
  });

  it("activities are visible: open shop, patrol, deliver, talk, enter a building", () => {
    const life = src("NpcLife.cs");
    assert.match(life, /act = job == Job\.Stall \? "open"/);
    assert.match(life, /act = "patrol"/);
    assert.match(life, /act = "deliver"/);
    assert.match(life, /TrySocial/);
    assert.match(life, /TryEnter/);
    assert.match(life, /CharacterGear\.Attach\(gameObject, "crate"/);
    assert.match(life, /opens a shop/);
    assert.match(life, /changes post/);
    assert.match(life, /enters a building/);
  });

  it("WorldClock rolls authored events and fauna hunt other fauna", () => {
    const book = src("WorldBook.cs");
    const evo = src("EvoSpawner.cs");
    assert.match(book, /TickEvents/);
    assert.match(book, /stores tightened/);
    assert.match(book, /EventKinds/);
    assert.match(book, /NoteBirth/);
    assert.doesNotMatch(book, /Concord admits he loves her/);
    assert.match(evo, /HuntPrey/);
    assert.match(evo, /CityAtlas\.For\(WorldClock\.World\)/);
  });

  it("a world is a kingdom: staple, regions, and an audit of authored layers", () => {
    const book = src("WorldBook.cs");
    assert.match(book, /class KingdomBook/);
    assert.match(book, /WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR/);
    assert.match(book, /Staple\(WorldId id\)/);
    assert.match(book, /We will not be reaped|harvest/);
    assert.match(book, /The Court is the city/);
    assert.match(book, /not a ninth Refusal gate/);
    assert.doesNotMatch(book, /Concord admits he loves her/);
  });

  it("the gate is a connection: cargo, carried kit, plots, and travelers persist", () => {
    const book = src("WorldBook.cs");
    const game = src("ConcordiaGame.cs");
    assert.match(book, /class CrossRing/);
    assert.match(book, /public static string Walk\(/);
    assert.match(book, /AwayTick/);
    assert.match(book, /plot-bill/);
    assert.match(book, /plot-eighth/);
    assert.match(book, /travelersCsv/);
    assert.match(book, /The invoice followed you through a door/);
    assert.match(game, /CrossRing\.Walk\(/);
    assert.match(game, /CrossRing\.LivingLines/);
    assert.doesNotMatch(book, /Concord admits he loves her/);
  });

  it("stock becomes a caravan with a real Ring tariff, never an invented city", () => {
    const book = src("WorldBook.cs");
    const gate = src("WorldGate.cs");
    const client = src("ConcordClient.cs");
    const hud = src("ConcordiaHUD.cs");
    assert.match(book, /caravansCsv/);
    assert.match(book, /tariffsCsv/);
    assert.match(book, /DispatchCaravan/);
    assert.match(book, /status = "loading"/);
    assert.match(book, /status = "traveling"/);
    assert.match(book, /status = "at_gate"/);
    assert.match(book, /RingTariff = 0\.05f/);
    assert.match(book, /class RingCaravan/);
    assert.match(gate, /class GatePost/);
    assert.match(gate, /Concordant Watch/);
    assert.match(gate, /Not an authored citizen/);
    assert.match(client, /kingdom:request/);
    assert.match(client, /concord-kingdom\/v1/);
    assert.match(client, /ApplyKingdom/);
    assert.match(hud, /ConcordClient\.HudLine/);
    assert.doesNotMatch(book, /Aurelia/);
    assert.doesNotMatch(gate, /Aurelia/);
    assert.doesNotMatch(client, /Aurelia/);
    assert.doesNotMatch(book, /Concord admits he loves her/);
  });

  it("DressVocab picks a culture kit per WorldId and never invents a kingdom name", () => {
    const packs = src("FreePacks.cs");
    const fill = src("RealmFill.cs");
    const interior = src("BuildingInterior.cs");
    assert.match(packs, /class DressVocab/);
    assert.match(packs, /return "court"/);
    assert.match(packs, /return "grove"/);
    assert.match(packs, /return "ash"/);
    assert.match(packs, /return "street"/);
    assert.match(packs, /return "grid"/);
    assert.match(packs, /return "drift"/);
    assert.match(packs, /Assets\/Store/);
    assert.match(packs, /IsStorePath/);
    assert.match(packs, /PlayableRooms\(int cityIndex\) => cityIndex == 0 \? 4 : 0/);
    assert.match(packs, /WantsFakeWindows/);
    assert.match(packs, /HasStoreStem/);
    assert.match(packs, /87811/);
    assert.match(packs, /house\.002/);
    assert.match(packs, /Room_Big_Part_01/);
    assert.match(packs, /WORLD NEED vs HAVE/);
    assert.match(packs, /public static string Weapon/);
    assert.match(packs, /Mega Fantasy Props/);
    assert.doesNotMatch(packs, /slavic/i);
    assert.doesNotMatch(packs, /Aurelia/);
    assert.doesNotMatch(packs, /Concord admits he loves her/);
    assert.match(fill, /DressVocab\.Kit\(/);
    assert.match(fill, /BuildingInterior\.FakeWindows/);
    assert.match(fill, /FortRim/);
    assert.match(fill, /concordia-visual\.txt/);
    assert.match(fill, /DressVocab\.Cart\(/);
    assert.match(src("WorldKit.cs"), /DressVocab\.Kit\(/);
    assert.match(src("WorldBuilder.cs"), /DressVocab\.House\(/);
    assert.match(src("WorldBuilder.cs"), /The frontier keeps no seat/);
    assert.match(src("WorldBuilder.cs"), /DressVocab\.Dummy\(/);
    assert.match(src("CharacterGear.cs"), /DressVocab\.Weapon/);
    assert.match(interior, /public static void FakeWindows/);
    assert.match(interior, /FakeWindow/);
  });

  it("cook is a station you walk to, and talk carries the last event as a rumor", () => {
    const gate = src("WorldGate.cs");
    const game = src("ConcordiaGame.cs");
    const fill = src("RealmFill.cs");
    assert.match(gate, /class CookStation/);
    assert.match(gate, /The stove is cold/);
    assert.match(game, /cook\.Use\(\)/);
    assert.match(game, /They heard:/);
    assert.match(game, /AskTwoB/);
    assert.match(game, /ConcordConvaiManager/);
    assert.match(game, /concord-2b/);
    assert.match(src("ConcordClient.cs"), /dialogue:request/);
    assert.match(src("ConcordClient.cs"), /AskTwoB/);
    assert.match(src("ConcordClient.cs"), /kitchenUrl, gatewayUrl/);
    assert.match(fill, /Sidewalks/);
    assert.match(fill, /a guard/);
    assert.match(fill, /WorldClock\.Ecology < 0\.28f/);
  });
});
