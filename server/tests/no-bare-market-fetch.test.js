// Static guard: the CoinGecko / Yahoo / Frankfurter / open.er-api upstream hosts are named in exactly ONE
// server module (lib/market-feed-sources.js). Every caller reads through its feed-cache sources, so a new
// bare fetch to one of these hosts (which would bypass the shared cache, budget, SSRF guard and attribution
// rules) turns this test red.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = path.join("lib", "market-feed-sources.js");
const HOSTS = [
  "api.coingecko.com",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "api.frankfurter.app",
  "api.frankfurter.dev",
  "open.er-api.com",
];
const SKIP_DIRS = new Set(["node_modules", "data", "tests", ".git", "coverage", "dist", "build", "uploads", "logs"]);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) yield* walk(path.join(dir, ent.name));
    } else if (/\.(m?js|cjs)$/.test(ent.name)) {
      yield path.join(dir, ent.name);
    }
  }
}

/** Drop block comments and // line comments (not the // inside https://). Host mentions in prose are fine. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

test("the market upstream hosts appear only in lib/market-feed-sources.js", () => {
  const offenders = [];
  let scanned = 0;
  for (const file of walk(serverRoot)) {
    const rel = path.relative(serverRoot, file);
    if (rel === HELPER) continue;
    if (fs.statSync(file).size > 8 * 1024 * 1024) continue;
    scanned++;
    const code = stripComments(fs.readFileSync(file, "utf8"));
    for (const host of HOSTS) {
      if (code.includes(host)) offenders.push(`${rel} names ${host}`);
    }
  }
  assert.ok(scanned > 500, `expected to scan the server tree, scanned ${scanned}`);
  assert.deepEqual(offenders, [], `route these through lib/market-feed-sources.js:\n${offenders.join("\n")}`);
});

test("the helper itself names every host, and fetches only through fetchPublicUrl", () => {
  const code = stripComments(fs.readFileSync(path.join(serverRoot, HELPER), "utf8"));
  for (const host of HOSTS.filter((h) => !/query2|frankfurter\.app/.test(h))) assert.ok(code.includes(host), host);
  assert.match(code, /fetchPublicUrl\(/);
  assert.doesNotMatch(code, /(?<![\w.])fetch\(/, "no bare fetch() in the market helper");
  assert.doesNotMatch(code, /globalThis\.fetch/);
});

test("the lens domains no longer call fetch() for market data", () => {
  for (const f of ["crypto.js", "markets.js", "market.js", "finance.js", "accounting.js"]) {
    const code = stripComments(fs.readFileSync(path.join(serverRoot, "domains", f), "utf8"));
    for (const host of HOSTS) assert.equal(code.includes(host), false, `${f} still names ${host}`);
  }
  // (crypto.js keeps unrelated fetch() calls to the 0x aggregator / chain RPC; only the market hosts are guarded.)
  const markets = stripComments(fs.readFileSync(path.join(serverRoot, "domains", "markets.js"), "utf8"));
  assert.doesNotMatch(markets, /globalThis\.fetch\(/);
  // (market.js keeps unrelated fetches elsewhere in the file; the Yahoo hosts check above covers its market reads.)
});
