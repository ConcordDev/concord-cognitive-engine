#!/usr/bin/env node
// server/scripts/conkay-capture-constituents.mjs
//
// Operator tool (Blend D brief item 2): record PubChem's experimental Density and Melting Point sections for the
// Blend D mineral fillers (calcium carbonate CID 10112, silica CID 24261) through the knowledge layer's PubChem
// connector, and MERGE the excerpts into lib/conkay/knowledge/fixtures/connector-recordings.json for replay.
// Full responses go to the evidence store (CONKAY_EVIDENCE_DIR). Network access is used only here.
//   node server/scripts/conkay-capture-constituents.mjs [--out path]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { liveGetter, EvidenceStore } from "../lib/conkay/knowledge/connectors/fetcher.js";
import { experimental } from "../lib/conkay/knowledge/connectors/pubchem.js";
import { excerptPubchemView, recording } from "../lib/conkay/knowledge/connectors/recordings.js";

export const FILLERS = Object.freeze([
  { classId: "caco3", cid: 10112, subject: "substance:calcium-carbonate" },
  { classId: "silica", cid: 24261, subject: "substance:silica" },
]);
export const HEADINGS = Object.freeze(["Density", "Melting Point"]);

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(here, "../lib/conkay/knowledge/fixtures/connector-recordings.json");
const store = EvidenceStore.default();
const live = liveGetter({ store, retryDelayMs: 8000, maxAttempts: 8, minIntervalMs: 400 });
const seen = [];
const get = async (url) => { const d = await live(url); seen.push(d); return d; };
for (const f of FILLERS) {for (const h of HEADINGS) {
  const r = await experimental(f.cid, h, f.subject, get);
  console.log(`${f.classId} ${h}: ${r.notFound ? "not found" : `${r.claims?.length ?? 0} claims, ${r.reviews?.length ?? 0} reviews`}`);
}}
const file = JSON.parse(fs.readFileSync(out, "utf8"));
for (const d of seen) {
  if (!d.ok) { console.error("not recorded (failed):", d.url, d.error); continue; }
  file.recordings[d.url] = d.notFound ? { url: d.url, retrieved: d.retrieved, notFound: true, body: d.body } : recording(d.url, d.body, excerptPubchemView(d.body), d.retrieved);
}
fs.writeFileSync(out, JSON.stringify(file, null, 2) + "\n"); // the file's own 2-space format, so a merge only adds lines
console.log(`merged ${seen.length} documents into ${out}; evidence store: ${store.dir}`);
