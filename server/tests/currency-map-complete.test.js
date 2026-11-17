// server/tests/currency-map-complete.test.js
//
// SB-30 pin (MEGA PLAN v2, Track B / SB-G5; executes CI-01): the currency
// map is complete — every server file that reads or writes the legacy
// concordia_credits column appears in lib/currency-map.js with a class
// and a provenance. Migrations 045/415 are history and test files pin
// the writers, so both are excluded (the plan row's own exclusion).
// Fails pristine (no map exists), passes with SB-30.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENCY_MAP, currencyClassForFile } from "../lib/currency-map.js";

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_FILES = new Set([
  "migrations/045_concordia_credits.js",
  "migrations/415_hermes_zero_balance.js",
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".js") || name.endsWith(".mjs")) yield p;
  }
}

function filesCarryingTheColumn() {
  const out = [];
  for (const p of walk(SERVER_ROOT)) {
    const rel = relative(SERVER_ROOT, p).split("\\").join("/");
    if (rel.startsWith("tests/") || rel.startsWith("tests\\")) continue;
    if (EXCLUDED_FILES.has(rel)) continue;
    if (readFileSync(p, "utf8").includes("concordia_credits")) out.push(`server/${rel}`);
  }
  return out.sort();
}

test("every server file carrying concordia_credits is in the currency map with a class", () => {
  const carriers = filesCarryingTheColumn();
  assert.ok(carriers.length > 0, "census found no carriers — the scan itself is broken");
  for (const file of carriers) {
    const entry = currencyClassForFile(file);
    assert.ok(entry, `${file} carries concordia_credits but is missing from lib/currency-map.js`);
    assert.ok(entry.class, `${file} is in the map without a class`);
    assert.ok(entry.provenance && entry.provenance.length > 20, `${file} is in the map without a provenance`);
  }
});

test("the map names no file that does not carry the column", () => {
  const carriers = new Set(filesCarryingTheColumn());
  for (const entry of CURRENCY_MAP) {
    assert.ok(carriers.has(entry.file), `${entry.file} is mapped but carries no concordia_credits at this head`);
  }
});

test("the map covers both founder classes and the split/shared cases", () => {
  const classes = new Set(CURRENCY_MAP.map((e) => e.class));
  assert.ok(classes.has("GAMEPLAY"), "no GAMEPLAY (→ Sparks) entries");
  assert.ok(classes.has("USER_DTU_SALE"), "no USER_DTU_SALE (→ Concord Coin) entries");
  assert.ok(classes.has("SPLIT"), "no SPLIT (provenance-decides) entries");
  assert.ok(classes.has("SHARED"), "no SHARED entries");
});
