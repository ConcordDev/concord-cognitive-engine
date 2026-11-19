#!/usr/bin/env node
/**
 * CP-10 — Activity density compiler (MST-W4-15, Concordia programme).
 *
 * Compiles CONCORDIA_PLAN §4.11's activity density targets into per-land
 * placement manifests. GATE-7 counts density from these manifests, not by
 * eye (plan §4.11: "CP-10 compiles these into placement data. The density
 * gate (GATE-7) counts them from the placement manifests").
 *
 * Targets (§4.11, per km²): major POI 1.5 · minor POI 6 · encounter
 * groups 10 · gatherable nodes 40 · quest touchpoints 3. The plan's own
 * per-16 km² column (24 · 96 · 160 · 640 · 48) is exact under the count
 * rule below.
 *
 * Count rule (declared, deterministic): for a land of area A km², the
 * compiled count for a category is round(target × A), halves rounded up
 * (Math.round). The manifest carries the exact product alongside the
 * rounded count so a gate can judge the rounding instead of trusting it.
 *
 * Placements are deterministic: a seeded PRNG (mulberry32, seed = FNV-1a
 * of "<land>|<category>") scatters points in the land's local frame,
 * [0, side) metres on each axis. The same input always compiles to the
 * same manifest, byte for byte, and each manifest carries an FNV-1a
 * checksum over its canonical form.
 *
 * Footprints come from §4.2 (Phase A = M5, Phase B = M7) via lands.json
 * beside this file; a caller may supply its own lands array of the same
 * shape ({name, sideKm: {A, B}}). Invalid input is refused with a named
 * error code — the compiler never emits a silently wrong count.
 *
 * CLI:
 *   node scripts/concordia/compile-activities.mjs [--phase A|B]
 *        [--input <lands.json>] [--out <manifest.json>]
 * Without --out, a per-land count summary prints to stdout. With --out,
 * the full manifest set ({phase, targets, lands, totals}) is written as
 * JSON and the summary still prints. Exit 0 on success, 2 on a refused
 * input (the error code prints to stderr).
 *
 * Library:
 *   import { compileActivities, DENSITY_TARGETS } from
 *     "./compile-activities.mjs";
 *   const { lands, totals } = compileActivities({ lands, phase: "A" });
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** §4.11 density targets, placements per km², in manifest order. */
export const DENSITY_TARGETS = Object.freeze({
  majorPoi: 1.5,
  minorPoi: 6,
  encounterGroups: 10,
  gatherableNodes: 40,
  questTouchpoints: 3,
});

export const CATEGORIES = Object.freeze(Object.keys(DENSITY_TARGETS));

export const PHASES = Object.freeze(["A", "B"]);

function fail(code, message) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
}

/** FNV-1a 32-bit hash of a string, as 8 hex chars. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** mulberry32 — small deterministic PRNG, seeded per land + category. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateLands(lands, phase) {
  if (!PHASES.includes(phase)) {
    throw fail("ERR_UNKNOWN_PHASE", `phase must be one of ${PHASES.join("/")}, got ${JSON.stringify(phase)}`);
  }
  if (!Array.isArray(lands) || lands.length === 0) {
    throw fail("ERR_NO_LANDS", "lands must be a non-empty array");
  }
  const seen = new Set();
  for (const land of lands) {
    if (land === null || typeof land !== "object" || typeof land.name !== "string" || land.name.length === 0) {
      throw fail("ERR_LAND_SHAPE", "each land must be an object with a non-empty string name");
    }
    if (seen.has(land.name)) {
      throw fail("ERR_DUPLICATE_LAND", `duplicate land name: ${land.name}`);
    }
    seen.add(land.name);
    const side = land.sideKm?.[phase];
    if (typeof side !== "number" || !Number.isFinite(side)) {
      throw fail("ERR_SIDE_NOT_FINITE", `${land.name}: sideKm.${phase} must be a finite number, got ${JSON.stringify(side)}`);
    }
    if (side <= 0) {
      throw fail("ERR_SIDE_NOT_POSITIVE", `${land.name}: sideKm.${phase} must be > 0, got ${side}`);
    }
  }
}

function compileLand(land, phase) {
  const sideKm = land.sideKm[phase];
  const footprintKm2 = sideKm * sideKm;
  const sideMeters = sideKm * 1000;
  const landSlug = slug(land.name);
  const counts = {};
  const exact = {};
  const placements = [];
  for (const category of CATEGORIES) {
    const product = DENSITY_TARGETS[category] * footprintKm2;
    exact[category] = product;
    const count = Math.round(product);
    counts[category] = count;
    const rand = mulberry32(parseInt(fnv1a(`${land.name}|${category}`), 16));
    for (let i = 0; i < count; i++) {
      placements.push({
        id: `${landSlug}:${category}:${i}`,
        category,
        x: Math.round(rand() * sideMeters * 10) / 10,
        z: Math.round(rand() * sideMeters * 10) / 10,
      });
    }
  }
  const manifest = {
    land: land.name,
    phase,
    sideKm,
    footprintKm2,
    targetsPerKm2: { ...DENSITY_TARGETS },
    exactProducts: exact,
    counts,
    placements,
  };
  manifest.checksum = fnv1a(
    JSON.stringify([manifest.land, manifest.phase, manifest.counts, manifest.placements]),
  );
  return manifest;
}

/**
 * Compile placement manifests for every land at a phase.
 * @param {{lands: Array<{name: string, sideKm: {A: number, B: number}}>, phase: "A"|"B"}} input
 * @returns {{phase: string, targetsPerKm2: object, lands: object[], totals: object}}
 */
export function compileActivities({ lands, phase = "A" } = {}) {
  validateLands(lands, phase);
  const compiled = lands.map((land) => compileLand(land, phase));
  const totals = {};
  for (const category of CATEGORIES) {
    totals[category] = compiled.reduce((sum, m) => sum + m.counts[category], 0);
  }
  totals.placements = compiled.reduce((sum, m) => sum + m.placements.length, 0);
  return { phase, targetsPerKm2: { ...DENSITY_TARGETS }, lands: compiled, totals };
}

/** The §4.2 land table shipped beside this compiler (lands.json). */
export function defaultLands() {
  const path = fileURLToPath(new URL("./lands.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")).lands;
}

function printSummary(result) {
  const header = ["land", "km2", ...CATEGORIES];
  console.log(header.join("\t"));
  for (const m of result.lands) {
    console.log([m.land, m.footprintKm2, ...CATEGORIES.map((c) => m.counts[c])].join("\t"));
  }
  console.log(["TOTAL", "", ...CATEGORIES.map((c) => result.totals[c])].join("\t"));
  console.log(`phase ${result.phase} · ${result.totals.placements} placements`);
}

function main(argv) {
  let phase = "A";
  let inputPath = null;
  let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--phase") phase = argv[++i];
    else if (argv[i] === "--input") inputPath = argv[++i];
    else if (argv[i] === "--out") outPath = argv[++i];
    else throw fail("ERR_UNKNOWN_ARG", `unknown argument: ${argv[i]}`);
  }
  const lands = inputPath
    ? JSON.parse(readFileSync(inputPath, "utf8")).lands
    : defaultLands();
  const result = compileActivities({ lands, phase });
  if (outPath) {
    writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  }
  printSummary(result);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
