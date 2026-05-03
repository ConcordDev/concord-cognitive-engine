/**
 * Example: send a Concord Link courier message and subscribe to delivery.
 *
 *   npx tsx examples/link-send.ts
 *
 * Set CONCORD_API_KEY=csk_... in your environment first.
 */

import ConcordClient from "../index.js";

const client = new ConcordClient(process.env.CONCORD_API_KEY ?? "", {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});

async function main() {
  // Subscribe to delivery + interception events. Fires once for each
  // event the walker reports back from the field.
  const unsubscribe = client.link.subscribe((event, payload) => {
    console.log(`[${event}]`, payload);
  });

  // Send a courier package.
  const sent = await client.link.send({
    receiverId: "user_alice",
    message: "The cipher journals are at the third anchor.",
    worldId: "concordia",
  });
  console.log("send result:", sent);

  // Inbox check.
  const inbox = await client.link.inbox();
  console.log("inbox:", inbox);

  // Stay alive 60s to receive delivery / intercept events.
  await new Promise((r) => setTimeout(r, 60_000));
  unsubscribe();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
