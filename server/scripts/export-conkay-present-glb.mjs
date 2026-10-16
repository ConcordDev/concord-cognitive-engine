#!/usr/bin/env node
// Presentation GLB (normals + clearcoat paint) from a kernel body.stl.
// Presentation only: the kernel's body.glb and its receipts are untouched.
//   node scripts/export-conkay-present-glb.mjs BODY.stl OUT.glb
import fs from "node:fs";
import { presentGlbFromStl } from "../lib/conkay/assembly/present-glb.js";

const [stlPath, outPath] = process.argv.slice(2);
if (!stlPath || !outPath) {
  console.error("usage: export-conkay-present-glb.mjs BODY.stl OUT.glb");
  process.exit(2);
}
const r = presentGlbFromStl(fs.readFileSync(stlPath), { source: { stl: stlPath.split("/").slice(-2).join("/") } });
fs.writeFileSync(outPath, r.glb);
console.log(JSON.stringify({ out: outPath, bytes: r.glb.length, sha256: r.sha256, triangles: r.triangles, vertices: r.vertices }));
