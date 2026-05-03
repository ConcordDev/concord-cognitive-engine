/**
 * Example: fork a DTU with auto-citation, then publish to the marketplace.
 *
 * Citation cascade: when you cite an existing DTU, 95% of any future
 * earnings on the new fork flow back to the cited author's lineage.
 */

import ConcordClient from "../index.js";

const client = new ConcordClient(process.env.CONCORD_API_KEY ?? "", {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});

async function main() {
  // Find a DTU we want to extend.
  const list = await client.dtus.list({ limit: 5, domain: "agriculture" });
  const original = (list as { dtus?: { id: string; title: string }[] }).dtus?.[0];
  if (!original) throw new Error("no DTUs to fork");

  // Fork: create a new DTU that cites the original.
  const fork = await client.dtus.create({
    title: `Refinement of: ${original.title}`,
    body: "Adds drought-tolerance schedule for arid valleys.",
    domain: "agriculture",
    tags: ["fork", "drought-tolerance"],
    meta: { citedDtuIds: [original.id] },
  });
  console.log("forked:", fork);

  // Explicit citation (optional — if the fork DTU doesn't carry citedDtuIds in meta).
  const newId = (fork as { dtu?: { id: string } }).dtu?.id;
  if (newId) {
    await client.marketplace.cite(newId, original.id, "Direct extension of base schedule");
  }

  // Publish to marketplace at 3 CC. Server runs the repair brain pre-flight
  // and rejects with score < 40.
  if (newId) {
    const submitted = await client.marketplace.submit(newId, 3);
    console.log("listed:", submitted);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
