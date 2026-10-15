// server/scripts/record-conkay-live-run.mjs
//
// Record an orchestrator run for the live build page (/conkay/designs/<id>/live): runs designFromChat on the
// prompt with the real pipeline (the car needs the OCC kernel), collects its progress events, and writes
// lib/conkay/showcase/live/<id>.json with the snapshot STLs beside it. Nothing is solved when the page replays.
//
//   node scripts/record-conkay-live-run.mjs ev-180 "Design a four-seat electric car that holds 180 mph"

import { designFromChat } from "../lib/conkay/chat/run.js";
import { recordLiveRun } from "../lib/conkay/chat/live.js";

const [id, prompt] = process.argv.slice(2);
if (!id || !prompt) {
  console.error('usage: node scripts/record-conkay-live-run.mjs <id> "<prompt>"');
  process.exit(2);
}
const events = [];
const t = Date.now();
const r = await designFromChat(prompt, { onEvent: (e) => events.push(e) });
const run = recordLiveRun({ id, prompt, events });
console.log(`${id}: ${r.stage} ${r.outcome?.kind ?? ""}, ${run.events.length} events, ${run.files.length} snapshot file(s), ${Math.round((Date.now() - t) / 1000)} s`);
process.exit(0);
