/**
 * Example: invoke a lens macro and print the structured response.
 *
 * Every domain in the platform exposes its functionality as a macro:
 *   POST /api/lens/run { domain, name, input }
 *
 * The SDK wraps that with `client.lens.run(domain, name, input)`.
 */

import ConcordClient from "../index.js";

const client = new ConcordClient(process.env.CONCORD_API_KEY ?? "", {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});

async function main() {
  // Run the agriculture lens's "soil-analysis" macro.
  const ag = await client.lens.run("agriculture", "soil-analysis", {
    region: "Hudson Valley",
    pH: 6.4,
    organicMatter: 4.1,
  });
  console.log("agriculture/soil-analysis:", ag);

  // Run the council lens's "preview-vote" macro.
  const council = await client.lens.run("council", "preview-vote", {
    proposalText: "Should the substrate prioritize archive recovery over forward synthesis this week?",
  });
  console.log("council/preview-vote:", council);

  // Run intelligence views.
  const weather = await client.intelligence.knowledgeWeather();
  console.log("knowledge weather:", weather);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
