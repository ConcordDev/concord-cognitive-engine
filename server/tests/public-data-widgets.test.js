// Static checks for feed-cache phase 8d: the last browser-direct widgets —
// the four CoinGecko panels and the NVD / EONET / Gutendex / Sketchfab / USGS /
// FEMA / REST Countries / sunrise-sunset / Imgflip / Onionoo / npm / OpenRouter
// widgets — now read through the server (crypto.coingecko-* actions on the
// shared market cache, and the public-lookup domain's public-data actions).
// No network, no rendering: source assertions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FE = path.resolve(here, "../../concord-frontend");
const COMPONENTS = path.join(FE, "components");

const CG_WIDGETS = [
  "crypto/CoinGeckoTicker.tsx",
  "finance/MarketsPulse.tsx",
  "staking/StakingMarkets.tsx",
  "wallet/WalletMarkets.tsx",
];
const DATA_WIDGETS = {
  "audit/CveSearch.tsx": "nvd-cves",
  "debug/NvdCveFeed.tsx": "nvd-cves",
  "sentinel/SentinelCves.tsx": "nvd-cves",
  "events/NasaEarthEvents.tsx": "eonet-events",
  "world/EarthEventsLive.tsx": "eonet-events",
  "creative-writing/GutendexSearch.tsx": "gutendex-books",
  "education/GutenbergCurriculum.tsx": "gutendex-books",
  "ar/SketchfabModels.tsx": "sketchfab-search",
  "emergency-services/QuakeFeed.tsx": "usgs-quakes",
  "crisis-ops/FemaDisasters.tsx": "fema-disasters",
  "global/CountryAtlas.tsx": "restcountries-region",
  "expedition-journal/BaseCampAlmanac.tsx": "sunrise-sunset",
  "animation/AnimationReference.tsx": "imgflip-memes",
  "anon/TorNetworkStatus.tsx": "onionoo-summary",
  "app-maker/NpmPackageSearch.tsx": "npm-search",
  "byo-keys/OpenRouterCatalog.tsx": "openrouter-models",
};

const read = (rel) => fs.readFileSync(path.join(COMPONENTS, rel), "utf8");

test("static: CoinGecko panels read through the crypto domain's cached actions", () => {
  for (const rel of CG_WIDGETS) {
    const src = read(rel);
    assert.ok(src.includes("lensRun"), `${rel} should use lensRun`);
    assert.ok(src.includes("'coingecko-"), `${rel} should call a coingecko-* action`);
    assert.ok(src.includes('DataAttribution provider="coingecko"'), `${rel} must keep the visible CoinGecko attribution`);
    assert.equal(src.includes("api.coingecko.com"), false, `${rel} must not reference the CoinGecko API host`);
    assert.equal(src.includes("fetch("), false, `${rel} must not fetch directly`);
  }
});

test("static: public-data widgets call their public-lookup action", () => {
  for (const [rel, action] of Object.entries(DATA_WIDGETS)) {
    const src = read(rel);
    assert.ok(src.includes("publicLookup"), `${rel} should use the public-lookup client`);
    assert.ok(src.includes(`'${action}'`), `${rel} should call the ${action} action`);
    assert.equal(src.includes("fetch("), false, `${rel} must not fetch directly`);
  }
});

test("static: no frontend file calls the phase-8d upstream endpoints directly", () => {
  const FRAGMENTS = [
    "api.coingecko.com/api/v3", "services.nvd.nist.gov/rest/json", "eonet.gsfc.nasa.gov/api/v3",
    "gutendex.com/books?", "api.sketchfab.com/v3", "earthquake.usgs.gov/earthquakes/feed",
    "restcountries.com/v3.1/region", "api.sunrise-sunset.org/json", "api.imgflip.com/get_memes",
    "onionoo.torproject.org/summary?", "registry.npmjs.org/-/v1", "openrouter.ai/api/v1",
    "www.fema.gov/api/open",
  ];
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const offenders = [];
  for (const f of [...walk(COMPONENTS), ...walk(path.join(FE, "app")), ...walk(path.join(FE, "lib"))]) {
    const s = fs.readFileSync(f, "utf8");
    for (const frag of FRAGMENTS) {
      if (s.includes(frag)) offenders.push(`${path.relative(FE, f).split(path.sep).join("/")}: ${frag}`);
    }
  }
  assert.deepEqual(offenders, []);
});
