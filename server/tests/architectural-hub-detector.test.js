// tests/architectural-hub-detector.test.js
//
// Bidirectional pin for architectural-hub-detector: a module with fan-in
// above FAN_IN_THRESHOLD (50) must be flagged as a hub (split-risk or, when
// fan-in × fan-out also clears HUB_OF_HUBS_THRESHOLD, hub-of-hubs); a module
// at or below the threshold must NOT be flagged. A genuine import cycle of
// more than 3 modules must be flagged; a plain two-file mutual import must
// not (below the cycle-length threshold the detector actually enforces).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runArchitecturalHubDetector } from "../lib/detectors/architectural-hub-detector.js";

async function tmpRepo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ahd-"));
  await mkdir(path.join(dir, "server"), { recursive: true });
  return dir;
}

/** Write `count` trivial files under server/ that each `import` the given
 * relative spec (e.g. "./hub.js"). Used to drive a target module's fan-in. */
async function writeImporters(dir, count, importSpec, { subdir = "server", prefix = "importer" } = {}) {
  const target = path.join(dir, subdir);
  await mkdir(target, { recursive: true });
  for (let i = 0; i < count; i++) {
    await writeFile(path.join(target, `${prefix}${i}.js`), `import "${importSpec}";\n`, "utf8");
  }
}

describe("architectural-hub detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS architectural_hub_split_risk for fan-in > 50 with low fan-out", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "hub.js"), `import "./dep.js";\n`, "utf8");
    await writeFile(path.join(dir, "server", "dep.js"), `// leaf\n`, "utf8");
    await writeImporters(dir, 51, "./hub.js"); // fan-in 51 > 50 threshold

    const r = await runArchitecturalHubDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.subject?.path === "server/hub.js");
    assert.ok(hit, "hub.js with fan-in 51 must be flagged");
    assert.equal(hit.id, "architectural_hub_split_risk");
    assert.equal(hit.severity, "high");
    assert.equal(hit.evidence.fanIn, 51);
    assert.equal(hit.evidence.fanOut, 1);
    assert.equal(hit.evidence.product, 51);
  });

  it("does NOT flag a module at exactly the fan-in threshold (50, not > 50)", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "hub.js"), `import "./dep.js";\n`, "utf8");
    await writeFile(path.join(dir, "server", "dep.js"), `// leaf\n`, "utf8");
    await writeImporters(dir, 50, "./hub.js"); // fan-in exactly 50

    const r = await runArchitecturalHubDetector({ root: dir });
    const hit = r.findings.find((f) => f.subject?.path === "server/hub.js");
    assert.equal(hit, undefined, "fan-in of exactly 50 is <= threshold, must not be flagged");
  });

  it("FLAGS architectural_hub_of_hubs (critical) when fan-in × fan-out > 1000", async () => {
    dir = await tmpRepo();
    // hub2 imports 25 distinct real files -> fan-out 25.
    const depImports = [];
    for (let i = 0; i < 25; i++) {
      await writeFile(path.join(dir, "server", `dep2-${i}.js`), `// leaf\n`, "utf8");
      depImports.push(`import "./dep2-${i}.js";`);
    }
    await writeFile(path.join(dir, "server", "hub2.js"), depImports.join("\n") + "\n", "utf8");
    await writeImporters(dir, 51, "./hub2.js"); // fan-in 51

    const r = await runArchitecturalHubDetector({ root: dir });
    const hit = r.findings.find((f) => f.subject?.path === "server/hub2.js");
    assert.ok(hit, "hub2.js with fan-in 51 x fan-out 25 = 1275 must be flagged");
    assert.equal(hit.id, "architectural_hub_of_hubs");
    assert.equal(hit.severity, "critical");
    assert.equal(hit.evidence.fanIn, 51);
    assert.equal(hit.evidence.fanOut, 25);
    assert.equal(hit.evidence.product, 1275);
  });

  it("FLAGS architectural_leaf_utility (info, not split-risk) when fan-out is 0", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "hub3.js"), `// no local imports at all\n`, "utf8");
    await writeImporters(dir, 51, "./hub3.js");

    const r = await runArchitecturalHubDetector({ root: dir });
    const hits = r.findings.filter((f) => f.subject?.path === "server/hub3.js");
    assert.equal(hits.length, 1, "a leaf-utility hub must produce exactly one finding, not also a split-risk one");
    assert.equal(hits[0].id, "architectural_leaf_utility");
    assert.equal(hits[0].severity, "info");
    assert.equal(hits[0].evidence.fanOut, 0);
  });

  it("FLAGS architectural_import_cycle for a genuine 4-module cycle", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "a.js"), `import "./b.js";\n`, "utf8");
    await writeFile(path.join(dir, "server", "b.js"), `import "./c.js";\n`, "utf8");
    await writeFile(path.join(dir, "server", "c.js"), `import "./d.js";\n`, "utf8");
    await writeFile(path.join(dir, "server", "d.js"), `import "./a.js";\n`, "utf8");

    const r = await runArchitecturalHubDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "architectural_import_cycle");
    assert.ok(hit, "a 4-module import cycle must be flagged");
    assert.equal(hit.severity, "high");
    const rels = hit.evidence.cycle;
    for (const f of ["server/a.js", "server/b.js", "server/c.js", "server/d.js"]) {
      assert.ok(rels.includes(f), `cycle evidence must include ${f}`);
    }
    const summary = r.findings.find((f) => f.id === "architectural_hub_summary");
    assert.ok(summary.evidence.cyclesCount >= 1);
  });

  it("does NOT flag a plain two-file mutual import as a cycle (below the length threshold)", async () => {
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "x.js"), `import "./y.js";\n`, "utf8");
    await writeFile(path.join(dir, "server", "y.js"), `import "./x.js";\n`, "utf8");

    const r = await runArchitecturalHubDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "architectural_import_cycle");
    assert.equal(hit, undefined, "a simple mutual two-file import must not be reported as an architectural cycle");
  });

  it("does NOT count importers under a /tests/ path toward fan-in (test-file exclusion)", async () => {
    // Real detector logic: buildImportGraph's outer loop `continue`s before
    // recording adjacency for any source file matching /\/tests?\// or
    // *.test.js — so importer files that live under server/tests/ never
    // contribute their own import edges, even though they still appear in
    // the raw `files` list used for path resolution.
    dir = await tmpRepo();
    await writeFile(path.join(dir, "server", "hub4.js"), `// leaf\n`, "utf8");
    await writeImporters(dir, 50, "../hub4.js"); // 50 real importers, fan-in 50 (not yet over threshold)
    // 15 more importers living under server/tests/ — if counted, fan-in would
    // become 65 (> 50) and hub4.js would wrongly be flagged.
    await writeImporters(dir, 15, "../hub4.js", { subdir: "server/tests", prefix: "extra" });

    const r = await runArchitecturalHubDetector({ root: dir });
    const hit = r.findings.find((f) => f.subject?.path === "server/hub4.js");
    assert.equal(hit, undefined, "importers living under server/tests/ must not count toward fan-in");
  });
});
