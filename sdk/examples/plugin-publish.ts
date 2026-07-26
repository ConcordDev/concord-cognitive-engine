/**
 * Example: sign and publish a plugin to the gallery, then install it.
 *
 * Publishing is signature-optional but a signed package registered under
 * a trusted key is what earns the gallery's `trusted` badge. Installing
 * genuinely loads the plugin through the same hardened validator + sandbox
 * path as a boot-time disk scan — a rejected package comes back as an
 * honest `ok:false`, never a fake "installed" success.
 */

import ConcordClient from "../index.js";

const client = new ConcordClient(process.env.CONCORD_API_KEY ?? "", {
  baseUrl: process.env.CONCORD_BASE_URL ?? "http://localhost:5050",
});

async function main() {
  // Generate a signing keypair and register the public half as trusted
  // for this author. In practice the private key is kept offline and
  // used to sign package sources before publish.
  const keypair = await client.plugins.generateKeypair();
  console.log("keypair generated:", keypair.publicKeyPem.slice(0, 40) + "...");

  await client.plugins.registerKey(keypair.publicKeyPem);

  // Publish a small example plugin. `source` is stripped from public
  // reads of the gallery entry — this is the one call that carries it.
  const published = await client.plugins.publish({
    name: "example-greeter",
    description: "Logs a greeting whenever a lens action completes.",
    version: "0.1.0",
    source: "module.exports = { onLensAction: (ctx) => console.log('hi', ctx.domain) };",
  });
  console.log("published:", published);

  // Browse the gallery for it.
  const gallery = await client.plugins.gallery({ q: "greeter", limit: 5 });
  const entry = (gallery as { plugins?: { pluginId: string }[] }).plugins?.[0];
  if (!entry) throw new Error("published plugin not found in gallery");

  // Install — this actually loads the plugin (sandboxed + validated).
  const installed = await client.plugins.install(entry.pluginId);
  console.log("installed:", installed);

  // Rate it up.
  const rated = await client.plugins.rate(entry.pluginId, 1);
  console.log("rated:", rated);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
