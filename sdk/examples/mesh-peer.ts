/**
 * Example: discover mesh peers and sync DTUs over BLE / WiFi-Direct.
 *
 * The mesh layer exposes the full conflict-resolved DTU sync used by
 * the mobile app. Peers are visible whether they're across the room
 * (BLE) or one LoRa hop away (rural deployments).
 */

import ConcordClient from "../index.js";

const client = new ConcordClient(process.env.CONCORD_API_KEY ?? "", {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});

async function main() {
  const peers = await client.mesh.peers();
  console.log("visible peers:", peers);

  const peerList = (peers as { peers?: { id: string; transport: string }[] }).peers ?? [];
  const ble = peerList.find((p) => p.transport === "ble");
  if (!ble) {
    console.log("no BLE peers in range");
    return;
  }

  const paired = await client.mesh.pair(ble.id, "ble");
  console.log("pair:", paired);

  // Sync a single DTU we own. The conflict resolver merges divergent edits
  // by lineage rather than last-write-wins.
  const myDtus = await client.dtus.list({ limit: 1 });
  const dtuId = (myDtus as { dtus?: { id: string }[] }).dtus?.[0]?.id;
  if (dtuId) {
    const synced = await client.mesh.sync(ble.id, [dtuId]);
    console.log("sync result:", synced);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
