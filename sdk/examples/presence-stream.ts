/**
 * Example: subscribe to live world presence + combat netcode.
 *
 * Presence updates flow through the world socket — every player position,
 * every NPC patrol step, every hit. We aggregate them into a single feed
 * for an external dashboard or recording rig.
 */

import ConcordClient from "../index.js";

const client = new ConcordClient(process.env.CONCORD_API_KEY ?? "", {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});

async function main() {
  // Snapshot first so we know who's currently in the world.
  const snap = await client.presence.snapshot("concordia");
  console.log("snapshot:", snap);

  // Live presence stream.
  const offPresence = client.presence.subscribe("concordia", (event, payload) => {
    if (event === "city:positions") {
      const ps = (payload as { players?: unknown[] }).players ?? [];
      console.log(`[presence] ${ps.length} players visible`);
    }
  });

  // Live combat stream — every attack, hit, dodge, block, kill.
  const offCombat = client.combat.subscribe((event, payload) => {
    console.log(`[combat:${event}]`, payload);
  });

  await new Promise((r) => setTimeout(r, 60_000));
  offPresence();
  offCombat();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
