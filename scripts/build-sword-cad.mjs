// scripts/build-sword-cadrblue.mjs
//
// Build a real 3D CAD blueprint of a sword using Concord's parametric
// mesh + STL/GLB export pipeline. Output to /tmp so it can be inspected
// by an external CAD viewer.
//
// What it does:
//   1. Calls generateSwordMesh() with custom blade parameters (longsword-ish).
//   2. Writes binary STL via meshToSTL.
//   3. Packs GLB via packGLB (gltf-transform).
//   4. Computes real mass + center of mass + volume from the mesh.
//   5. Prints a CAD-style summary.
//
// This is the honest flow: every triangle traces to a real parametric
// generator; every byte of the output file is verifiable.

import fs from "fs";
import path from "path";
import { generateSwordMesh } from "../server/lib/asset-gen/parametric-mesh.js";
import { meshToSTL } from "../server/lib/asset-gen/stl-export.js";
import { packGLB, isGlbSource, computeVertexNormals } from "../server/lib/evo-asset/glb-bridge.js";
import { massProperties, centerOfMass } from "../server/lib/asset-gen/mass-properties.js";

// ── Parameters: a medieval-style arming sword (1.0m, hand-and-a-half) ──────
// All values in meters. Real CAD scale.
const SWORD = {
  bladeLength: 0.85,        // 85 cm blade
  bladeBaseWidth: 0.05,     // 5 cm wide at the guard
  bladeBaseThickness: 0.006,// 6 mm thick at the base
  bladeSegments: 24,        // smooth taper
  guardWidth: 0.22,         // 22 cm — wide straight cross
  guardThickness: 0.02,      // 2 cm thick
  guardLength: 0.025,       // 2.5 cm deep
  hiltLength: 0.11,         // 11 cm grip
  hiltRadius: 0.018,        // 1.8 cm diameter grip
  pommelRadius: 0.028,      // 2.8 cm radius pommel
  pommelLength: 0.03,       // 3 cm pommel
  hiltSides: 12,            // smoother grip
};

// ── Output paths ──────────────────────────────────────────────────────────
const OUT_DIR = "/tmp/concord-sword-cad";
const STL_PATH = path.join(OUT_DIR, "arming-sword.stl");
const GLB_PATH = path.join(OUT_DIR, "arming-sword.glb");
const SUMMARY_PATH = path.join(OUT_DIR, "summary.json");

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`[sword] Building mesh with SWORD_DEFAULTS:`);
console.log(JSON.stringify(SWORD, null, 2));

// ── Step 1: generate mesh ─────────────────────────────────────────────────
const mesh = generateSwordMesh(SWORD);

const vertCount = mesh.positions.length / 3;
const triCount = mesh.indices.length / 3;

console.log(`[sword] Mesh generated:`);
console.log(`  vertices: ${vertCount}`);
console.log(`  triangles: ${triCount}`);
console.log(`  total length: ${mesh.meta.totalLength.toFixed(4)} m`);
console.log(`  welded: ${mesh.weld.weldedVertexCount} verts merged, ${mesh.weld.droppedTriangleCount} tris dropped`);
console.log(`  section vertex counts: ${mesh.meta.sectionVertexCounts.join(", ")}`);
console.log(`  section triangle counts: ${mesh.meta.sectionTriangleCounts.join(", ")}`);

// Compute vertex normals for proper shading
const meshWithNormals = {
  ...mesh,
  normals: computeVertexNormals(mesh.positions, mesh.indices),
};

// ── Step 2: export STL ────────────────────────────────────────────────────
const stlResult = meshToSTL(meshWithNormals);
if (!stlResult.ok) throw new Error(`STL export failed: ${JSON.stringify(stlResult)}`);
fs.writeFileSync(STL_PATH, stlResult.buffer);
const stlStat = fs.statSync(STL_PATH);
console.log(`[sword] STL written: ${STL_PATH}`);
console.log(`  size: ${(stlStat.size / 1024).toFixed(1)} KB`);
console.log(`  triangles: ${stlResult.triangleCount}, vertices: ${stlResult.vertexCount}`);

// ── Step 3: export GLB ────────────────────────────────────────────────────
await packGLB(meshWithNormals, GLB_PATH);
const glbStat = fs.statSync(GLB_PATH);
console.log(`[sword] GLB written: ${GLB_PATH}`);
console.log(`  size: ${(glbStat.size / 1024).toFixed(1)} KB`);
console.log(`  isGlbSource: ${isGlbSource(GLB_PATH)}`);

// ── Step 4: mass properties (real CAD materials) ─────────────────────────
const massSteelA36 = massProperties(meshWithNormals, "steel-a36");
const massSteel4140 = massProperties(meshWithNormals, "steel-4140");
const massTitanium = massProperties(meshWithNormals, "titanium-ti6al4v");
const com = centerOfMass(meshWithNormals.positions, meshWithNormals.indices);

console.log(`[sword] Mass properties:`);
console.log(`  volume: ${(massSteelA36.volume_m3 * 1e6).toFixed(1)} cm^3 (${(massSteelA36.volume_m3 * 1000).toFixed(2)} L)`);
console.log(`  mass as ASTM A36 steel: ${(massSteelA36.mass_kg * 1000).toFixed(0)} g`);
console.log(`  mass as AISI 4140 steel: ${(massSteel4140.mass_kg * 1000).toFixed(0)} g`);
console.log(`  mass as titanium Ti-6Al-4V: ${(massTitanium.mass_kg * 1000).toFixed(0)} g`);
console.log(`  center of mass: (${com.map((v) => v.toFixed(4)).join(", ")}) m (tip-relative)`);
console.log(`  density used: A36=${massSteelA36.material.density} kg/m^3, 4140=${massSteel4140.material.density} kg/m^3, Ti=${massTitanium.material.density} kg/m^3`);

// ── Step 5: STL sanity-check (file size + header magic) ─────────────────
const stlData = fs.readFileSync(STL_PATH);
// Binary STL: 80-byte header, then uint32 LE triangle count, then 50*N bytes
const headerSlice = stlData.subarray(0, 80);
const triangleCountInBinary = stlData.readUInt32LE(80);
const expectedTotal = 84 + 50 * triangleCountInBinary;
console.log(`[sword] STL sanity:`);
console.log(`  header (first 40): ${JSON.stringify(headerSlice.subarray(0, 40).toString("latin1"))}`);
console.log(`  triangle count (uint32 LE @80): ${triangleCountInBinary}`);
console.log(`  total bytes: ${stlData.length}, expected: ${expectedTotal}, match: ${stlData.length === expectedTotal}`);

// ── Step 6: write summary ──────────────────────────────────────────────────
const summary = {
  parameters: SWORD,
  mesh: {
    vertices: vertCount,
    triangles: triCount,
    totalLength_m: mesh.meta.totalLength,
    sectionVertexCounts: mesh.meta.sectionVertexCounts,
    sectionTriangleCounts: mesh.meta.sectionTriangleCounts,
    welded: {
      vertices: mesh.weld.weldedVertexCount,
      droppedTriangles: mesh.weld.droppedTriangleCount,
    },
  },
  files: {
    stl: { path: STL_PATH, size_bytes: stlSize(stlStat.size) },
    glb: { path: GLB_PATH, size_bytes: stlSize(glbStat.size) },
  },
  mass: {
    steel_a36_g: Math.round(massSteelA36.mass_kg * 1000),
    steel_4140_g: Math.round(massSteel4140.mass_kg * 1000),
    titanium_g: Math.round(massTitanium.mass_kg * 1000),
    volume_cm3: Math.round(massSteelA36.volume_m3 * 1e6),
    centerOfMass_m: com,
  },
  stlParse: {
    triangleCount: triangleCountInBinary,
    sizeBytes: stlData.length,
    matchesSpec: stlData.length === expectedTotal,
  },
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
console.log(`[sword] Summary: ${SUMMARY_PATH}`);

function stlSize(bytes) { return bytes; }

console.log(`\n[done] Sword CAD blueprint built. Open in any STL or GLB viewer.`);
console.log(`  STL: ${STL_PATH}`);
console.log(`  GLB: ${GLB_PATH}`);