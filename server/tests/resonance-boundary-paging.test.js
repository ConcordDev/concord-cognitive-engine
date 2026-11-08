// Resonance build — S-RES-2: the boundary macro's pairs surfacing.
// The boundary/scan/history macros live in server.js, so this suite drives
// the macro by verbatim extraction (marker-sliced from the shipped file,
// helpers included) over synthetic DTU fixtures — the computation under
// test is the file's own code, not a copy of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const serverSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "server.js"),
  "utf8",
);

function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `marker found: ${marker}`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated: ${marker}`);
}
function sliceStmt(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `marker found: ${marker}`);
  const end = src.indexOf(";", start);
  return src.slice(start, end + 1);
}

const helpers = [
  sliceStmt(serverSrc, "const nowISO ="),
  sliceStmt(serverSrc, "const clamp ="),
  sliceFn(serverSrc, "function normalizeText"),
  sliceFn(serverSrc, "function clamp01"),
  sliceFn(serverSrc, "function jaccard"),
  sliceFn(serverSrc, "function crispnessScore"),
  sliceFn(serverSrc, "function _normAtom"),
  sliceFn(serverSrc, "function buildCretiText"),
].join("\n");

const boundaryStart = serverSrc.indexOf('register("resonance", "boundary"');
assert.ok(boundaryStart >= 0, "boundary registration found");
const summaryAt = serverSrc.indexOf("Resonance boundary detection", boundaryStart);
const boundaryEnd = serverSrc.indexOf("});", summaryAt) + 3;
const boundarySrc = serverSrc.slice(boundaryStart, boundaryEnd);

function makeBoundary(dtus) {
  const registry = new Map();
  // eslint-disable-next-line no-new-func -- these tests execute function bodies sliced out of server.js (not importable: server.js is a monolith), so dynamic construction is the point
  const factory = new Function(
    "register",
    "dtusArray",
    "realtimeEmit",
    `${helpers}\n${boundarySrc}\nreturn register;`,
  );
  factory(
    (ns, name, fn) => registry.set(`${ns}.${name}`, fn),
    () => dtus,
    () => {},
  );
  return registry.get("resonance.boundary");
}

function fixtureDtus() {
  const domains = ["immunology", "music", "cooking"];
  const words = {
    immunology: "antibody lymphocyte pathogen vaccine cytokine",
    music: "melody harmony rhythm timbre cadence",
    cooking: "simmer caramel sear emulsion umami",
  };
  const out = [];
  for (const domain of domains) {
    for (let i = 0; i < 10; i++) {
      out.push({
        id: `dtu_${domain}_${i}`,
        title: `${domain} study ${i}`,
        tier: "regular",
        tags: [domain],
        lineage: { parents: [], children: [] },
        human: { summary: `${words[domain]} note ${i}` },
        core: {
          invariants: ["feedback loop", "threshold response", "memory of state"],
          claims: [`${words[domain]} claim`],
        },
      });
    }
  }
  return out;
}

test("S-RES-2: the full pair set pages, and the distribution accounts for it", () => {
  const boundary = makeBoundary(fixtureDtus());
  const base = boundary({}, {});
  assert.equal(base.ok, true);
  assert.equal(base.crossDomainAlignment.pairsFound, 75);
  assert.equal(base.crossDomainAlignment.topPairs.length, 10, "topPairs stays the top-10 slice");
  assert.equal(base.crossDomainAlignment.pairsPage.length, 10, "the default page is 10");

  const page1 = boundary({}, { pairsOffset: 0, pairsLimit: 5 });
  const page2 = boundary({}, { pairsOffset: 5, pairsLimit: 5 });
  assert.equal(page1.crossDomainAlignment.pairsPage.length, 5);
  assert.equal(page2.crossDomainAlignment.pairsPage.length, 5);
  assert.notEqual(
    page1.crossDomainAlignment.pairsPage[0].a.id,
    page2.crossDomainAlignment.pairsPage[0].a.id,
    "the second page starts further down the ranked set",
  );
  const tail = boundary({}, { pairsOffset: 70, pairsLimit: 25 });
  assert.equal(tail.crossDomainAlignment.pairsPage.length, 5, "the tail page reaches pair #75");

  const dist = base.crossDomainAlignment.scoreDistribution;
  const bucketTotal = dist.buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(bucketTotal, 75, "the distribution accounts for every pair");
  assert.ok(dist.p50 > 0, "the median score is reported");
});

test("the density guard still answers honestly below 20 DTUs", () => {
  const boundary = makeBoundary(fixtureDtus().slice(0, 5));
  const out = boundary({}, {});
  assert.equal(out.ok, false);
  assert.match(out.error, /Insufficient DTU density/);
});
