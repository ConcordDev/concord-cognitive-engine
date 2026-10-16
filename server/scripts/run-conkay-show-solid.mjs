#!/usr/bin/env node
// Visual polish (c): cut the design-surface apertures into a copy of the analysed body and print the re-check
// receipts (cad.show-solid). Opt-in on the vehicle (props.vehicle.showSolid = true); the analysed body is unchanged.
//   node scripts/run-conkay-show-solid.mjs ["brief"] [--json OUT.json]
import fs from "node:fs";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const out = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const brief = args[0] || "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const b = buildCarFromLibrary(brief);
if (b.error) { console.error(b.error); process.exit(1); }
const veh = b.ir.nodes.find((n) => n.props?.vehicle?.packaging);
veh.props.vehicle.showSolid = true;
const opened = openDesign(b.ir);
if (!opened.ok) { console.error(JSON.stringify(opened.errors)); process.exit(1); }
const t0 = Date.now();
await opened.session.settle();
const r = opened.session.result(`cad.show-solid@${veh.id}`);
const o = r.outputs || {};
const summary = {
  status: r.status, reason: r.reason || null, seconds: Math.round((Date.now() - t0) / 1000),
  failures: r.failures || [], warnings: r.warnings || [],
  apertures: o.apertures?.value, skipped: o.skipped?.value, volumes: o.volumes?.value,
  solid: o.solid?.value, worst: o.packaging?.value?.worst, short: o.packaging?.value?.short,
  raysMoved: (o.rays?.value || []).filter((x) => x.deltaM && Math.abs(x.deltaM) > 1e-4), raysThroughGlass: (o.rays?.value || []).filter((x) => x.firstGlass).map((x) => `${x.id}→${x.firstGlass}`),
  stiffness: o.stiffness?.value, aero: o.aero?.value, files: o.files?.value,
};
console.log(JSON.stringify(summary, null, 2));
if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2));
