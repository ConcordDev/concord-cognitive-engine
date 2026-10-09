#!/usr/bin/env node
// server/scripts/conkay-capture-knowledge.mjs
//
// Operator tool: run knowledge-layer demo 2 against the live PubChem and NIST
// WebBook services, keep every full response in the evidence store
// (CONKAY_EVIDENCE_DIR), and write the recorded EXCERPTS the tests and the
// offline demo replay (lib/conkay/knowledge/fixtures/connector-recordings.json).
// Network access is used only here, never by the server or the tests.
//   node server/scripts/conkay-capture-knowledge.mjs [--out path]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liveGetter, EvidenceStore } from "../lib/conkay/knowledge/connectors/fetcher.js";
import { mixtureReport, DEMO2 } from "../lib/conkay/knowledge/connectors/mixture.js";
import { excerptPubchemView, excerptNistTable, excerptNistPage, recording } from "../lib/conkay/knowledge/connectors/recordings.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(here, "../lib/conkay/knowledge/fixtures/connector-recordings.json");
const store = EvidenceStore.default();
const live = liveGetter({ store, retryDelayMs: 8000, maxAttempts: 8, minIntervalMs: 400 });
const seen = [];
const recordingGetter = async (url) => { const d = await live(url); seen.push(d); return d; };

const report = await mixtureReport(recordingGetter, DEMO2);
if (!report.ok) { console.error("demo failed:", report.reason); process.exit(1); }
const keepK = [DEMO2.temperatureK, 273.15, 277.15, 298.15];
const recordings = {};
for (const d of seen) {
  if (!d.ok) { console.error("not recorded (failed):", d.url, d.error); continue; }
  if (d.notFound) { recordings[d.url] = { url: d.url, retrieved: d.retrieved, notFound: true, body: d.body }; continue; }
  let ex = d.body;
  if (d.url.includes("/pug_view/")) ex = excerptPubchemView(d.body);
  else if (d.url.includes("fluid.cgi?Action=Data")) ex = excerptNistTable(d.body, keepK);
  else if (d.url.includes("fluid.cgi?Action=Load")) ex = excerptNistPage(d.body);
  recordings[d.url] = recording(d.url, d.body, ex, d.retrieved);
}
fs.writeFileSync(out, JSON.stringify({ captured: new Date().toISOString().slice(0, 10), note: "Recorded excerpts of live responses; fullSha256 identifies each full response as retrieved (full documents are in the capturing operator's evidence store, not in the repo).", recordings }, null, 1) + "\n");
console.log(`recorded ${Object.keys(recordings).length} documents -> ${out}; evidence store: ${store.dir}`);
