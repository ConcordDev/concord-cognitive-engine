// server/tests/conkay-showcase.test.js
//
// The ConKay results page's snapshots (lib/conkay/showcase): every showcase
// design is built, its files match their recorded hashes, every value carries
// one of the page's statuses, and an unknown is never given a number. The
// designs that run without the OCC kernel are rebuilt here and must equal the
// committed snapshot byte for byte (a stale snapshot fails: re-run
// `node scripts/build-conkay-showcase.mjs`). The car needs the kernel to
// rebuild; its committed snapshot is checked for shape and file hashes only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SHOWCASE, STATUSES, SNAPSHOT_DIR, BUILDERS, finalizeSnapshot, loadSnapshot, loadSnapshotFile, listSnapshots, statusFromBasis, statusFromClaim, statusFromMassState } from "../lib/conkay/showcase/index.js";

const sha = (b) => createHash("sha256").update(b).digest("hex");

describe("showcase snapshots", () => {
  for (const entry of SHOWCASE) {
    it(`${entry.id}: built, hashed, every value has a status`, () => {
      const s = loadSnapshot(entry.id);
      assert.ok(s, `${entry.id}.json missing: run node scripts/build-conkay-showcase.mjs`);
      const { snapshotSha256, ...body } = s;
      assert.equal(sha(JSON.stringify(body)), snapshotSha256, "snapshot hash");
      for (const f of s.files) assert.equal(sha(fs.readFileSync(path.join(SNAPSHOT_DIR, entry.id, f.name))), f.sha256, f.name);
      for (const d of s.drawings) for (const f of d.files) assert.ok(s.files.some((x) => x.name === f.name && x.sha256 === f.sha256), f.name);
      assert.ok(s.values.length > 0 && s.checks.length > 0);
      for (const v of s.values) {
        assert.ok(STATUSES.includes(v.status), `${v.id}: ${v.status}`);
        if (v.status === "unknown") assert.equal(v.value, null, `${v.id}: an unknown has no number`);
        if (v.source?.url) assert.match(v.source.url, /^https:\/\//, v.id);
      }
      for (const c of s.checks) assert.ok(["PASS", "WARN", "FAIL", "NOT_COMPUTED", "ERROR"].includes(c.status), c.runId);
      assert.ok(s.disclaimers.length > 0 && s.physicalTests.length > 0);
    });
  }

  it("the nuclear snapshot is labelled screening-only", () => {
    const s = loadSnapshot("nuscale-us600");
    assert.ok(s.disclaimers.some((d) => /screening-only/i.test(d)));
    assert.ok(s.values.filter((v) => v.status === "unknown").length > 0, "FSAR gaps stay unknown");
  });

  it("the car carries its drawing, its kernel mesh and its mass by state", () => {
    const s = loadSnapshot("car");
    assert.equal(s.drawings.length, 1);
    assert.ok(s.drawings[0].files.some((f) => f.kind === "pdf"));
    assert.equal(s.model3d?.format, "stl");
    const stl = fs.readFileSync(path.join(SNAPSHOT_DIR, "car", s.model3d.name));
    assert.equal(stl.readUInt32LE(80) * 50 + 84, stl.length, "binary STL: 84 + 50 bytes per triangle");
    const sum = Object.values(s.mass.byState).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - s.mass.totalKg) < 0.5, `by-state ${sum} vs total ${s.mass.totalKg}`);
  });

  for (const id of ["sentinel-m1", "usb-blend-d", "methanol-water", "nuscale-us600"]) {
    it(`${id}: a rebuild equals the committed snapshot`, async () => {
      const built = await BUILDERS[id]();
      const snap = finalizeSnapshot(SHOWCASE.find((e) => e.id === id), built.snapshot, built.files);
      assert.equal(snap.snapshotSha256, loadSnapshot(id).snapshotSha256, `${id} snapshot is stale: run node scripts/build-conkay-showcase.mjs ${id}`);
    });
  }
});

describe("serving", () => {
  it("lists every design and serves only listed files whose hash matches", () => {
    assert.deepEqual(listSnapshots().map((d) => d.id), SHOWCASE.map((e) => e.id));
    assert.equal(loadSnapshot("../car"), null);
    assert.equal(loadSnapshot("unknown-design"), null);
    const s = loadSnapshot("nuscale-us600");
    const f = loadSnapshotFile("nuscale-us600", s.files[0].name);
    assert.equal(f.contentType, "image/svg+xml");
    assert.equal(loadSnapshotFile("nuscale-us600", "../car.json"), null);
    assert.equal(loadSnapshotFile("nuscale-us600", "car.json"), null);
  });

  it("refuses a file that drifted from its snapshot", () => {
    const tmp = fs.mkdtempSync(path.join(SNAPSHOT_DIR, "..", ".tmp-"));
    try {
      const s = loadSnapshot("nuscale-us600");
      fs.writeFileSync(path.join(tmp, "nuscale-us600.json"), JSON.stringify(s));
      fs.mkdirSync(path.join(tmp, "nuscale-us600"));
      fs.writeFileSync(path.join(tmp, "nuscale-us600", s.files[0].name), "<svg>tampered</svg>");
      assert.equal(loadSnapshotFile("nuscale-us600", s.files[0].name, tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("status mapping", () => {
  it("reads solver bases, claim statuses and mass states", () => {
    assert.equal(statusFromBasis("computed: SHA-256 of …"), "computed");
    assert.equal(statusFromBasis("model_output_unvalidated"), "computed");
    assert.equal(statusFromBasis("sourced: data sheet"), "sourced");
    assert.equal(statusFromBasis("design choice"), "design");
    assert.equal(statusFromBasis("estimated (± 10 %)"), "estimated");
    assert.equal(statusFromClaim(["unknown"]), "unknown");
    assert.equal(statusFromClaim(["contradicted"]), "unknown");
    assert.equal(statusFromClaim(["sourced"]), "sourced");
    assert.equal(statusFromClaim(["computed", "estimated"]), "estimated");
    assert.equal(statusFromMassState("sourced", "measured"), "measured");
    assert.equal(statusFromMassState("placeholder"), "unknown");
    assert.equal(statusFromMassState("requirement"), "design");
  });
});
