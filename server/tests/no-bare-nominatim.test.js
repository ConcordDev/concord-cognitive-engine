// Nominatim has a 1 req/s app-wide policy. The public host may be named in
// exactly one place: lib/geo-feed-sources.js, the queued + cached helper.
// A second occurrence means someone added a bare, unlimited caller.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const repoDir = path.resolve(serverDir, "..");
const HOST = "nominatim.openstreetmap.org";
const SKIP = new Set(["node_modules", "tests", "data", ".next", ".git", "coverage", "public"]);
const EXT = /\.(js|mjs|cjs|ts|tsx|jsx)$/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.test(e.name)) yield p;
  }
}

function offenders(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const f of walk(root)) if (fs.readFileSync(f, "utf8").includes(HOST)) out.push(path.relative(repoDir, f));
  return out;
}

test("the Nominatim host appears only in lib/geo-feed-sources.js", () => {
  const found = [
    ...offenders(serverDir),
    ...["app", "components", "lib"].flatMap((d) => offenders(path.join(repoDir, "concord-frontend", d))),
  ].sort();
  assert.deepEqual(found, ["server/lib/geo-feed-sources.js"]);
});

test("every Nominatim caller imports the helper", () => {
  for (const f of ["atlas", "logistics", "travel", "automotive", "free-api-live"]) {
    const src = fs.readFileSync(path.join(serverDir, "domains", `${f}.js`), "utf8");
    assert.match(src, /lib\/geo-feed-sources\.js/, `${f}.js must use geo-feed-sources`);
  }
});
