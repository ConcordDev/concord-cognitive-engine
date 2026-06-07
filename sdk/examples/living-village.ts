/**
 * living-village.ts — the Wave 7 demo: drop a village of instinct NPCs, deploy one
 * autonomous agent among them, and watch the cost telemetry prove the claim.
 *
 * The point: a whole village lives on the 4-tier instinct loop for ~zero idle compute.
 * The LLM wakes ONLY on salience (a charged exchange, a real dilemma). So a thousand
 * NPCs cost like ten — run this against your own Ollama/OpenAI via BYO and watch
 * /api/admin/inference-costs to see it.
 *
 *   npm i @concord/sdk
 *   CONCORD_API_KEY=csk_... CONCORD_BASE_URL=http://localhost:5050 \
 *     npx tsx sdk/examples/living-village.ts
 */
import ConcordClient from "../index";

async function main() {
  const client = new ConcordClient(process.env.CONCORD_API_KEY || "csk_dev", {
    baseUrl: process.env.CONCORD_BASE_URL || "http://localhost:5050",
  });
  const worldId = process.env.CONCORD_WORLD_ID || "concordia-hub";

  // 1. Populate the village — instinct NPCs. They run on perception → affect → drives →
  //    releasers every tick with no LLM. (Reuses the world spawn macro.)
  for (let i = 0; i < 20; i++) {
    await client.npc.spawn(worldId, { species: i % 3 === 0 ? "deer" : "humanoid", name: `villager_${i}` });
  }
  console.log("Spawned 20 instinct NPCs — they now live for free.");

  // 2. Deploy ONE autonomous agent among them (Sparks-only, fenced). Requires
  //    CONCORD_AGENT_ENABLED=1 on the server.
  const deploy = await client.agent.deploy({
    worldId,
    coreValues: ["curiosity", "care_for_others", "non_coercion"],
    intent: "to live in this town, make friends, and find my craft",
  });
  const agentId = (deploy as { agentId?: string }).agentId;
  console.log("Deployed agent:", agentId, (deploy as { self?: { given_name?: string } }).self?.given_name);

  if (agentId) {
    // 3. Inspect its self-model + read its awareness correlate (NOT a consciousness claim).
    const who = await client.agent.inspect(agentId);
    console.log("Self:", JSON.stringify(who, null, 2));
    const aware = await client.agent.awarenessIndex(agentId);
    console.log("Awareness index (access correlate / PCI-proxy):", aware);
  }

  // 4. The proof: how much did all of that actually cost in LLM calls?
  const costs = await client.request("GET", "/api/admin/inference-costs?hours=1");
  console.log("Cost over the last hour:", costs);
  console.log("→ note how the call count tracks SALIENT exchanges, not the NPC head-count.");
}

main().catch((err) => { console.error(err); process.exit(1); });
