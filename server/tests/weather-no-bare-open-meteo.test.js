// Static guard: the Open-Meteo hosts are named in exactly one server module (lib/weather-feed-sources.js),
// so no domain, tick or route can grow its own uncached call, and the browser never calls the provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendComponents = path.resolve(serverDir, "..", "concord-frontend", "components");
const SKIP = new Set(["node_modules", "tests", "data", ".cache", ".next", "coverage"]);
const HELPER = path.join("lib", "weather-feed-sources.js");

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

test("api.open-meteo.com (and its marine/air/archive/geocoding subdomains) appears only in lib/weather-feed-sources.js", () => {
  const offenders = [];
  for (const f of walk(serverDir, [".js", ".mjs", ".cjs"])) {
    const rel = path.relative(serverDir, f);
    if (rel === HELPER) continue;
    if (/api\.open-meteo\.com/.test(fs.readFileSync(f, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `route Open-Meteo through lib/weather-feed-sources.js: ${offenders.join(", ")}`);
  assert.ok(/api\.open-meteo\.com/.test(fs.readFileSync(path.join(serverDir, HELPER), "utf8")), "helper must own the host");
});

test("no frontend component calls the Open-Meteo API directly", () => {
  const offenders = [];
  for (const f of walk(frontendComponents, [".ts", ".tsx"])) {
    if (/api\.open-meteo\.com|open-meteo\.com\/v1/.test(fs.readFileSync(f, "utf8"))) offenders.push(path.relative(frontendComponents, f));
  }
  assert.deepEqual(offenders, []);
});

test("the two former browser-direct widgets go through the server and show the attribution", () => {
  for (const rel of ["forecast/WeatherForecast.tsx", "desert/DesertWeatherWatch.tsx"]) {
    const src = fs.readFileSync(path.join(frontendComponents, rel), "utf8");
    assert.match(src, /lensRun[\s\S]{0,200}'forecast', 'realWeather'/, rel);
    assert.match(src, /Weather data by Open-Meteo\.com/, rel);
    assert.match(src, /CC BY 4\.0/, rel);
  }
});
