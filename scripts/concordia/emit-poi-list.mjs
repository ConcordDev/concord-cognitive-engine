#!/usr/bin/env node
/**
 * CP-W26 — Wilderness POIs (a): the per-land wilderness POI list.
 *
 * CP-10's activity density compiler (compile-activities.mjs) places five
 * categories per land at the CONCORDIA_PLAN §4.11 densities. Two of them
 * are the wilderness POIs — majorPoi (1.5/km²) and minorPoi (6/km²).
 * This script derives the POI list per land from the compiler's
 * manifests for one footprint phase: every POI placement, with its
 * authored id and coordinates, plus the per-land counts the acceptance
 * checks ("POI list per land meets the targets", flag cf.world.pois).
 *
 * The list is a pure view of the compiler output — no new placement
 * logic, no second source of counts: if the compiler's counts move,
 * this list moves with them, and the test pins both against §4.11.
 *
 * Library:
 *   import { emitPoiList, POI_KINDS } from "./emit-poi-list.mjs";
 *   const list = emitPoiList({ lands, phase: "A" });
 *
 * CLI:
 *   node emit-poi-list.mjs [--phase A|B] [--input lands.json] [--out list.json]
 *   Without --out the JSON list is written to stdout. Named refusals
 *   exit 2, mirroring the compiler's convention.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileActivities,
  defaultLands,
  DENSITY_TARGETS,
  PHASES,
  fnv1a,
} from "./compile-activities.mjs";

/** The placement categories that are wilderness POIs, in list order. */
export const POI_KINDS = Object.freeze(["majorPoi", "minorPoi"]);

/** The content-flag this list feeds (master spec, CP-W26). */
export const POI_FLAG = "cf.world.pois";

function fail(code, detail) {
  const err = new Error(`${code}: ${detail}`);
  err.code = code;
  return err;
}

/**
 * Derive the per-land wilderness POI list from the compiler's manifests.
 * @param {{lands: Array<{name: string, sideKm: {A: number, B: number}}>, phase: "A"|"B"}} input
 * @returns {{flag: string, phase: string, targetsPerKm2: object, lands: object[], totals: object, checksum: string}}
 */
export function emitPoiList({ lands, phase = "A" } = {}) {
  if (!PHASES.includes(phase)) {
    throw fail("ERR_UNKNOWN_PHASE", `phase must be one of ${PHASES.join("/")}, got ${JSON.stringify(phase)}`);
  }
  // Lands validation + placement generation ride the compiler, so its
  // named refusals (ERR_NO_LANDS / ERR_LAND_SHAPE / ERR_DUPLICATE_LAND /
  // ERR_SIDE_NOT_FINITE / ERR_SIDE_NOT_POSITIVE) govern here unchanged.
  const compiled = compileActivities({ lands, phase });

  const listLands = compiled.lands.map((m) => {
    const pois = m.placements
      .filter((p) => POI_KINDS.includes(p.category))
      .map((p) => ({ id: p.id, kind: p.category, x: p.x, z: p.z }));
    return {
      land: m.land,
      footprintKm2: m.footprintKm2,
      counts: {
        majorPoi: m.counts.majorPoi,
        minorPoi: m.counts.minorPoi,
        total: m.counts.majorPoi + m.counts.minorPoi,
      },
      pois,
    };
  });

  const totals = {
    majorPoi: listLands.reduce((s, l) => s + l.counts.majorPoi, 0),
    minorPoi: listLands.reduce((s, l) => s + l.counts.minorPoi, 0),
    pois: listLands.reduce((s, l) => s + l.pois.length, 0),
  };

  const list = {
    flag: POI_FLAG,
    phase,
    targetsPerKm2: { majorPoi: DENSITY_TARGETS.majorPoi, minorPoi: DENSITY_TARGETS.minorPoi },
    lands: listLands,
    totals,
  };
  list.checksum = fnv1a(JSON.stringify([list.flag, list.phase, list.totals, list.lands.map((l) => l.pois)]));
  return list;
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
  const list = emitPoiList({ lands, phase });
  const json = JSON.stringify(list, null, 2) + "\n";
  if (outPath) writeFileSync(outPath, json);
  else process.stdout.write(json);
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
