// Unity tiers-plan foundations: ConcordClient must consume kernel events
// that this pass wired onto /unity-ws (scheme:overheard, perilKind, heir-rose).
//
//   cd server && node --test tests/unity-tiers-foundation.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT = join(
  import.meta.dirname,
  "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordClient.cs",
);
const HOSTILE = join(
  import.meta.dirname,
  "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Hostile.cs",
);
const PLOTS = join(
  import.meta.dirname,
  "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubObjectives.cs",
);

const client = readFileSync(CLIENT, "utf8");
const hostile = readFileSync(HOSTILE, "utf8");
const plots = readFileSync(PLOTS, "utf8");

test("ConcordClient consumes scheme:overheard with the kernel schemeId", () => {
  assert.match(client, /evt == "scheme:overheard"/);
  assert.match(client, /Plots\.Seed\(line, schemeId\)/);
});

test("ConcordClient reads combat:telegraph perilKind, not a local style hash", () => {
  assert.match(client, /JsonString\(text, "perilKind"\)/);
  assert.match(client, /Hostile\.BindKernel/);
  assert.match(hostile, /public static void BindKernel/);
});

test("ConcordClient does not barge-in on npc:conversation-bid", () => {
  assert.match(client, /evt == "npc:conversation-bid"/);
  assert.doesNotMatch(
    client,
    /evt == "npc:scheme-resolved" \|\| evt == "npc:conversation-bid"/,
  );
});

test("Plots only SendIntervene for a kernel scheme id", () => {
  assert.match(plots, /if \(_live\.kernel\)/);
  assert.match(plots, /client\.SendIntervene\(_live\.id, action\)/);
});

test("ConcordClient applies combat:impact momentum", () => {
  assert.match(client, /impactMomentum/);
  assert.match(client, /TakeHit\(/);
});

test("ConcordClient presents faction diplomacy from the kernel, not a local bar", () => {
  assert.match(client, /evt == "faction:war-declared"/);
  assert.match(client, /evt == "faction:alliance-formed"/);
  assert.match(client, /evt == "faction:truce-sought"/);
  assert.match(client, /JsonString\(text, "summary"\)/);
});

test("ConcordClient presents gatherings, bosses, seasons, festivals, stress-break", () => {
  assert.match(client, /evt == "world:gathering-detected"/);
  assert.match(client, /evt == "world:boss-spawn"/);
  assert.match(client, /evt == "world:season-transition"/);
  assert.match(client, /evt == "festival:started"/);
  assert.match(client, /evt == "npc:stress-break"/);
});

test("ConcordClient does not relabel an NPC harvest as a social gathering", () => {
  assert.match(client, /evt == "world:npc-gather"/);
  assert.match(client, /resourceName/);
  assert.doesNotMatch(client, /NoteAct\("a gathering"\)/);
});

test("ConcordClient consequence strip consumes gossip + lastWords", () => {
  assert.match(client, /PushFeed\("gossip"/);
  assert.match(client, /JsonString\(text, "lastWords"\)/);
  assert.match(client, /PushFeed\(/);
});

test("Unity collides kernel gossip, tombs, stress, banners, and inherited score in 3D", () => {
  const gate = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/WorldGate.cs",
  ), "utf8");
  const life = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/NpcLife.cs",
  ), "utf8");
  const gw = readFileSync(join(import.meta.dirname, "../lib/godot-gateway.js"), "utf8");
  assert.match(gate, /class KernelTomb/);
  assert.match(gate, /class GossipEar/);
  assert.match(gate, /class GatheringTell/);
  assert.match(life, /public void Cope\(/);
  assert.match(life, /public void HeadFor\(/);
  assert.match(client, /AdaptiveScore\.Apply\("faction:war-declared"\)/);
  assert.match(client, /setMusicCombatIntensity/);
  assert.match(client, /Intensity\(0\.85f\)/);
  assert.match(client, /Mode\("minor", 12000f\)/);
  assert.match(client, /evt == "npc:migrated"/);
  assert.match(client, /RealmFill\.MarkWar/);
  assert.match(client, /life\.Cope\(trait\)/);
  assert.match(client, /KernelTomb\.Place/);
  assert.match(client, /GossipEar\.Attach/);
  assert.match(gw, /npcA: r\.npc_a_id/);
  assert.match(gw, /npcB: r\.npc_b_id/);
});

test("Unity presents remaining kernel consequences without inventing engines", () => {
  const gate = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/WorldGate.cs",
  ), "utf8");
  const mixamo = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/MixamoAvatar.cs",
  ), "utf8");
  const packs = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/FreePacks.cs",
  ), "utf8");
  const play = readFileSync(join(import.meta.dirname, "../lib/concordia-play.js"), "utf8");
  const gw = readFileSync(join(import.meta.dirname, "../lib/godot-gateway.js"), "utf8");
  const worlds = readFileSync(join(import.meta.dirname, "../routes/worlds.js"), "utf8");
  const chronicle = readFileSync(join(import.meta.dirname, "../lib/combat/match-chronicle.js"), "utf8");
  const legacy = readFileSync(join(import.meta.dirname, "../lib/npc-legacy.js"), "utf8");
  assert.match(client, /evt == "npc:funeral"/);
  assert.match(client, /PresentFuneral/);
  assert.match(client, /WorldBoss\.Present/);
  assert.match(client, /evt == "combat:chronicle"/);
  assert.match(client, /ChroniclePlaque\.Place/);
  assert.match(client, /CraftedTell\.PlaceAtStation/);
  assert.match(client, /KitBag\.BindKernel/);
  assert.match(client, /evt == "kingdom:decree-enacted"/);
  assert.match(client, /evt == "dream:composed"/);
  assert.match(client, /evt == "prediction:realised"/);
  assert.match(client, /evt == "world:refusal-field"/);
  assert.match(client, /reason == "locked_out"/);
  assert.match(client, /DungeonGate\.EjectIfInside/);
  assert.match(gate, /class WorldBoss/);
  assert.match(gate, /No invented xz/);
  assert.match(gate, /class ChroniclePlaque/);
  assert.match(gate, /class CraftedTell/);
  assert.match(gate, /EjectIfInside/);
  assert.match(mixamo, /public void Hit\(\)/);
  assert.match(mixamo, /public void Stagger\(\)/);
  assert.match(packs, /cityIndex <= 2 \? 2 : 0/);
  assert.match(packs, /unique authored \.glb per world: none in tree/);
  assert.match(play, /reason === "locked_out"/);
  assert.match(play, /mechanic: ph\.mechanic/);
  assert.match(gw, /bosses: bossRows\.map/);
  assert.match(gw, /gear: snapshotGear/);
  assert.match(gw, /chronicles: snapshotChronicles/);
  assert.match(gw, /Never inserts a default loadout row/);
  assert.match(worlds, /event: "boss:state"/);
  assert.match(worlds, /event: "boss:phase-enter"/);
  assert.match(chronicle, /"combat:chronicle"/);
  assert.match(legacy, /"npc:funeral"/);
});

test("Level 1 funeral gathering uses real attendee ids, not invented mourners", () => {
  const life = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/NpcLife.cs",
  ), "utf8");
  const romance = readFileSync(join(import.meta.dirname, "../lib/romance-engine.js"), "utf8");
  const shapes = readFileSync(join(import.meta.dirname, "../lib/event-shapes.js"), "utf8");
  assert.match(life, /public void Attend\(/);
  assert.match(client, /life\.Attend\(/);
  assert.match(client, /GatheringTell\.PlaceAt/);
  assert.match(client, /evt == "npc:wedding"/);
  assert.match(client, /PresentWedding/);
  assert.match(romance, /"npc:wedding"/);
  assert.match(romance, /kind: "wedding"/);
  assert.match(shapes, /"npc:wedding"/);
});

test("Level 1 boss body fights at the hold and dies into a chronicle", () => {
  const gate = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/WorldGate.cs",
  ), "utf8");
  const play = readFileSync(join(import.meta.dirname, "../lib/concordia-play.js"), "utf8");
  const gw = readFileSync(join(import.meta.dirname, "../lib/godot-gateway.js"), "utf8");
  const dummy = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/TrainingDummy.cs",
  ), "utf8");
  assert.match(gate, /AddComponent<TrainingDummy>/);
  assert.match(gate, /AddComponent<Hostile>/);
  assert.match(gate, /public void Fall\(\)/);
  assert.match(gate, /No invented xz/);
  assert.match(dummy, /GetComponent<WorldBoss>/);
  assert.match(client, /dungeon:hit:ack/);
  assert.match(client, /SendDungeonHit/);
  assert.match(play, /export function handleDungeonHit/);
  assert.match(play, /recordHit\(/);
  assert.match(play, /mintMatchChronicle/);
  assert.match(gw, /case "dungeon:hit"/);
});

test("Level 1 Mixamo styles stance anticipation strike impact recovery", () => {
  const mixamo = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/MixamoAvatar.cs",
  ), "utf8");
  const canon = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Canon.cs",
  ), "utf8");
  const person = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ModularPerson.cs",
  ), "utf8");
  assert.match(canon, /enum FightStyle/);
  assert.match(canon, /PickFight/);
  assert.match(canon, /FightStyle\.Karate/);
  assert.match(canon, /FightStyle\.MuayThai/);
  assert.match(canon, /FightStyle\.WingChun/);
  assert.match(canon, /FightStyle\.Capoeira/);
  assert.match(canon, /FightStyle\.Sword/);
  assert.match(mixamo, /public void Anticipate\(\)/);
  assert.match(mixamo, /public void Knockdown\(\)/);
  assert.match(mixamo, /void ApplyStance\(\)/);
  assert.match(mixamo, /FightStyle\.WingChun/);
  assert.match(mixamo, /FightStyle\.Capoeira/);
  assert.match(person, /public void BindStyle\(/);
  assert.match(person, /public void Anticipate\(\)/);
});

test("Level 2 world silhouettes differ by architecture, not only palette", () => {
  const fill = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/RealmFill.cs",
  ), "utf8");
  assert.match(fill, /HubLook\.Point\(root, "NeonA"/);
  const crime = fill.split("case WorldId.Crime:")[1]?.split("case WorldId.Cyber:")[0] || "";
  assert.equal(crime.includes("Horizon("), false, "Crime is low-rise; no skyscraper horizon");
  assert.match(crime, /building-type-h/);
  assert.match(fill, /Ring\(root, DressVocab\.House\(WorldId\.Fantasy\)/);
  assert.match(fill, /Ring\(root, DressVocab\.House\(WorldId\.Frontier\)/);
  assert.match(fill, /w\.id == WorldId\.Crime \|\| w\.id == WorldId\.Sere/);
});

test("creature pillar compiles kernel genome, not a catalog kind", () => {
  const compiler = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/CreatureCompiler.cs",
  ), "utf8");
  const spawn = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/EvoSpawner.cs",
  ), "utf8");
  const fauna = readFileSync(join(
    import.meta.dirname,
    "../../apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/EvoSpawner.cs",
  ), "utf8");
  const gw = readFileSync(join(import.meta.dirname, "../lib/godot-gateway.js"), "utf8");
  const shapes = readFileSync(join(import.meta.dirname, "../lib/event-shapes.js"), "utf8");
  const creatures = readFileSync(join(import.meta.dirname, "../lib/concordia-creatures.js"), "utf8");
  assert.match(compiler, /class CreatureGenome/);
  assert.match(compiler, /class CreatureCard/);
  assert.match(compiler, /PresentKernel/);
  assert.match(compiler, /DressMorphology/);
  assert.match(spawn, /CreatureCompiler\.FromCritter/);
  assert.match(fauna, /BindGenome/);
  assert.match(client, /evt == "creature:born"/);
  assert.match(client, /PresentKernelCreatures/);
  assert.match(client, /PresentEcology/);
  assert.match(gw, /creatures: snapshotCreatures/);
  assert.match(gw, /ecology: snapshotEcology/);
  assert.match(shapes, /"creature:born"/);
  assert.match(creatures, /export function snapshotCreatures/);
  assert.match(creatures, /export function snapshotEcology/);
  assert.match(creatures, /export function announceCreatureBorn/);
  assert.doesNotMatch(spawn, /hint\.Contains\("quad"\) \? "wolf"/);
});
