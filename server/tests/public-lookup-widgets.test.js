// Static checks for feed-cache phase 8c part 2: the Stack Exchange and Hacker
// News widgets that used to call api.stackexchange.com / hn.algolia.com from
// the browser now read through the server's public-lookup domain (#1670) via
// the lib/public-lookup client. No network, no rendering: source assertions
// only, in the same style as the phase-8a/8b static checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.resolve(here, "../../concord-frontend/components");

const SE_WIDGETS = [
  "answers/StackOverflowSearch.tsx",
  "disputes/LawStackFeed.tsx",
  "ethics/PhilosophyStack.tsx",
  "film-studios/FilmStackFeed.tsx",
  "law/LawFeed.tsx",
  "math/MathStackFeed.tsx",
  "philosophy/PhiloFeed.tsx",
];
const HN_WIDGETS = [
  "chat/HackerNewsReference.tsx",
  "engineering/HnEngineeringFeed.tsx",
  "feed/HnFrontPage.tsx",
  "thread/ThreadFeed.tsx",
];

const read = (rel) => fs.readFileSync(path.join(COMPONENTS, rel), "utf8");

test("static: SE widgets call public-lookup se-search and show the CC BY-SA notice", () => {
  for (const rel of SE_WIDGETS) {
    const src = read(rel);
    assert.ok(src.includes("publicLookup"), `${rel} should use the public-lookup client`);
    assert.ok(src.includes("'se-search'"), `${rel} should call the se-search action`);
    assert.ok(src.includes('LookupNotice provider="stackexchange"'), `${rel} must render the Stack Exchange attribution notice`);
    assert.equal(src.includes("api.stackexchange.com"), false, `${rel} must not reference the SE API host`);
    assert.equal(src.includes("fetch("), false, `${rel} must not fetch directly`);
  }
});

test("static: HN widgets call public-lookup hn-search and surface stale state", () => {
  for (const rel of HN_WIDGETS) {
    const src = read(rel);
    assert.ok(src.includes("publicLookup"), `${rel} should use the public-lookup client`);
    assert.ok(src.includes("'hn-search'"), `${rel} should call the hn-search action`);
    assert.ok(src.includes("lookupMeta"), `${rel} must read lookup freshness for the cached-copy note`);
    assert.equal(src.includes("hn.algolia.com/api"), false, `${rel} must not reference the Algolia API host`);
    assert.equal(src.includes("fetch("), false, `${rel} must not fetch directly`);
  }
});

test("static: no component calls the Stack Exchange or HN Algolia APIs directly", () => {
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const offenders = walk(COMPONENTS)
    .filter((f) => {
      const s = fs.readFileSync(f, "utf8");
      return s.includes("api.stackexchange.com/2.3") || s.includes("hn.algolia.com/api/v1");
    })
    .map((f) => path.relative(COMPONENTS, f).split(path.sep).join("/"));
  assert.deepEqual(offenders, []);
});
