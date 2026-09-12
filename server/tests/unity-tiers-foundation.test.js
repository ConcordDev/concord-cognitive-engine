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
  assert.match(client, /intensity = 0\.85f/);
  assert.match(client, /holdMs = 12000f/);
  assert.match(client, /evt == "npc:migrated"/);
  assert.match(client, /RealmFill\.MarkWar/);
  assert.match(client, /life\.Cope\(trait\)/);
  assert.match(client, /KernelTomb\.Place/);
  assert.match(client, /GossipEar\.Attach/);
  assert.match(gw, /npcA: r\.npc_a_id/);
  assert.match(gw, /npcB: r\.npc_b_id/);
});
