# Concord SDK — Quickstart

`@concord/sdk` is the TypeScript client for the Concord substrate. It targets the
REST + macro surface of a running Concord server (default `http://localhost:5050`),
and exposes the Wave 7 **living-NPC / affect / autonomous-agent** layer as first-class
sub-clients.

The licensable idea in one line: **drop a thousand living NPCs into your game for the
cost of ten** — every NPC runs on a 4-tier instinct loop for ~zero idle compute, and an
LLM is summoned **only on salience** (a charged exchange, a real dilemma).

## Install

```bash
npm install @concord/sdk
```

## Authenticate

You need a Concord Secret Key (`csk_…`) or a JWT. Create a key from the dashboard or
via `client.keys.create(...)`.

```ts
import ConcordClient from "@concord/sdk";

const client = new ConcordClient(process.env.CONCORD_API_KEY!, {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});
```

## Run any macro

Every one of the ~495 registered domains is reachable. The hand-written sub-clients are
sugar over `POST /api/lens/:domain/:action`:

```ts
// hand-written client
await client.dtus.create({ title: "…", content: "…" });

// generic accessor — reach ANY domain
await client.domain("music").run("ai-playlist", { mood: "rainy" });
```

## The living-world layer (Wave 7)

```ts
// 1. Spawn instinct NPCs — they perceive → feel → drive → release every tick, no LLM.
await client.npc.spawn("concordia-hub", { species: "deer", name: "villager_1" });

// 2. Read any entity's felt state {umwelt, valence, arousal, drives}
const affect = await client.affect.ofAgent(agentId);

// 3. Deploy a persistent, fenced, Sparks-only autonomous agent (requires
//    CONCORD_AGENT_ENABLED=1 on the server).
const { agentId } = await client.agent.deploy({
  worldId: "concordia-hub",
  coreValues: ["curiosity", "care_for_others", "non_coercion"],
  intent: "to live here, make friends, and find my craft",
});

// 4. Inspect its self-model + autobiography, and read its awareness index.
const self = await client.agent.inspect(agentId);
const aware = await client.agent.awarenessIndex(agentId);
//   aware.awarenessIndex is an ACCESS correlate (a PCI-proxy), NOT a consciousness claim.
```

## Prove the cost story

After running a population, read the metering surface (admin-gated):

```ts
const costs = await client.request("GET", "/api/admin/inference-costs?hours=24");
// { calls, tokensIn, tokensOut, costLabel, byBrain }
// → the call count tracks SALIENT exchanges, not the NPC head-count.
```

Or surface it live at `/lenses/ops-telemetry`, and watch an agent's awareness curve at
`/lenses/reasoning/traces`.

## Full example

`sdk/examples/living-village.ts` drops 20 instinct NPCs + one autonomous agent and prints
the cost telemetry. Run it:

```bash
CONCORD_API_KEY=csk_… CONCORD_BASE_URL=http://localhost:5050 \
  npx tsx sdk/examples/living-village.ts
```

See also **[SELF_HOST.md](./SELF_HOST.md)** to run the whole substrate against your own
Ollama/OpenAI via BYO keys.
