// Expedition-Journal remainder pins (S-EJ-1 declaration · S-EJ-2 polar
// presentation · S-EJ-3 ID at save) — source pins in the fleet form, with
// the polar derivation exercised behaviourally on the verbatim-extracted
// helper (the component is .tsx; the helper's text is extracted and run).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const almanac = read("../components/expedition-journal/BaseCampAlmanac.tsx");
const manifest = read("../lib/lenses/manifest.ts");
const badge = read("../hooks/useDepthBadge.ts");

function extractPolar(source: string): (r: { sunrise?: string; sunset?: string; sun_status?: string }) => string | null {
  const start = source.indexOf("export function polarStatus");
  assert.ok(start >= 0, "polarStatus is exported from the almanac component");
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, "polarStatus body found");
  const raw = source.slice(start, end + 3);
  const bodyAt = raw.indexOf("): string | null {");
  assert.ok(bodyAt > 0, "polarStatus signature found");
  const text = `function polarStatus(r) ${raw.slice(bodyAt + "): string | null ".length)}`;
  return new Function(`${text}; return polarStatus;`)() as never;
}

test("S-EJ-2: the polar derivation names the status, never the sentinel", () => {
  const polarStatus = extractPolar(almanac);
  const sentinel = "1970-01-01T00:00:00+00:00";
  assert.equal(polarStatus({ sunrise: sentinel, sunset: sentinel, sun_status: "midnight_sun" }), "Midnight sun");
  assert.equal(polarStatus({ sunrise: sentinel, sunset: sentinel, sun_status: "polar_night" }), "Polar night");
  assert.equal(polarStatus({ sunrise: sentinel, sunset: sentinel }), "Polar — no sunrise or sunset today");
  // A normal row: rise and set differ → not polar.
  assert.equal(polarStatus({ sunrise: "2026-11-05T06:12:00+00:00", sunset: "2026-11-05T17:48:00+00:00" }), null);
  // Equal but not the midnight sentinel → not polar.
  assert.equal(polarStatus({ sunrise: "2026-11-05T06:12:00+00:00", sunset: "2026-11-05T06:12:00+00:00" }), null);
});

test("S-EJ-2: polar rows render dashes and the status; the save text follows", () => {
  assert.match(almanac, /sunrise — · sunset —/);
  assert.match(almanac, /sun_status\?: string/);
  assert.match(almanac, /const polar = polarStatus\(r\)/);
  // The duplicated source tag is gone from extraTags (the button adds it).
  assert.match(almanac, /extraTags=\{\['expedition-journal', 'almanac'\]\}/);
});

test("S-EJ-3: the almanac consumes onSaved and displays the saved DTU's ID", () => {
  assert.match(almanac, /onSaved=\{setSavedDtuId\}/);
  assert.match(almanac, /Saved as DTU \{savedDtuId\}/);
});

test("S-EJ-1: the manifest declares the tier and the caption names both halves", () => {
  const i = manifest.indexOf("domain: 'expedition-journal'");
  assert.ok(i >= 0);
  assert.match(manifest.slice(i, i + 200), /dataTier: 'SIM_GRADE_A'/);
  assert.match(badge, /'expedition-journal': \{\s*label: 'Simulated'/);
  assert.match(badge, /base-camp almanac is real sunrise-sunset data/);
});
