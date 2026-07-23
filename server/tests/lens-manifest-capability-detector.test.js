// server/tests/lens-manifest-capability-detector.test.js
//
// OP4 (2026-07-23) — pinning test for the lens-manifest capability-coverage
// detector: does concord-frontend/lib/lenses/manifest.ts's declarative
// `macros: {...}` capability claims actually resolve against the real
// server/-side register()/registerLensAction() registry?
//
// Bidirectional correctness:
//   1. Real flag — a synthetic manifest claim pointing at a domain/name pair
//      that is registered NOWHERE is flagged `manifest_macro_unbacked` (high).
//   2. No false positive — a claim using the literal "domain.name" 2-part
//      convention that IS registered, AND a claim using the generic
//      "lens.<artifactKind>.<verb>" 3-part convention (routing through the
//      real generic `register("lens", verb, …)` artifact-CRUD runtime) both
//      resolve cleanly with zero findings.
//   3. Real-tree check — run against the actual repo. This detector's first
//      run surfaced a REAL, then-unfixed drift in the `training-room`
//      manifest entry (`lens.training-room.list_skills` /
//      `lens.training-room.frame_data` — server/domains/training-room.js
//      registers `list_skills`/`frame_data` directly under domain
//      "training-room", never under the generic "lens" domain), the exact
//      bug class the manifest's OWN `sentinel` entry documents having been
//      manually fixed for once already ("Phantom `lens.sentinel.*` refs
//      replaced with the REAL registered macros"). That entry has now been
//      fixed (repointed to the literal "training-room.list_skills" /
//      "training-room.frame_data" 2-part form) — this assertion was updated
//      to match, per this comment's own original instruction: never loosen
//      the detector to keep a stale assertion green. The real-tree check now
//      asserts zero unbacked claims across the whole manifest.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runLensManifestCapabilityDetector,
  parseManifestMacroClaims,
  resolveManifestClaim,
} from "../lib/detectors/lens-manifest-capability-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

describe("lens-manifest-capability detector — pure helpers", () => {
  it("parseManifestMacroClaims extracts (manifestDomain, key, value) triples from a macros block", () => {
    const src = `
export const LENS_MANIFESTS = [
  { domain: 'careers', label: 'Careers', macros: { list: 'careers.tracks', get: 'careers.contracts', create: 'careers.work', run: 'careers.offer' }, exports: ['json'], actions: ['browse'] },
  { domain: 'ops-telemetry', label: 'Ops', macros: {}, exports: ['json'], actions: [] },
];
`;
    const claims = parseManifestMacroClaims(src);
    const careers = claims.filter((c) => c.manifestDomain === "careers");
    assert.equal(careers.length, 4);
    assert.deepEqual(
      careers.map((c) => `${c.key}=${c.value}`).sort(),
      ["create=careers.work", "get=careers.contracts", "list=careers.tracks", "run=careers.offer"]
    );
    const opsTelemetry = claims.filter((c) => c.manifestDomain === "ops-telemetry");
    assert.equal(opsTelemetry.length, 0, "an empty macros:{} object contributes zero claims");
  });

  it("resolveManifestClaim resolves a literal 2-part domain.name claim against the registered-pairs map", () => {
    const pairs = new Map([["careers tracks", { file: "x", line: 1 }]]);
    const hit = resolveManifestClaim("careers.tracks", pairs);
    assert.equal(hit.resolved, true);
    assert.equal(hit.domain, "careers");
    assert.equal(hit.name, "tracks");
    assert.equal(hit.viaGenericLens, false);

    const miss = resolveManifestClaim("careers.nonexistent", pairs);
    assert.equal(miss.resolved, false);
    assert.equal(miss.domain, "careers");
    assert.equal(miss.name, "nonexistent");
  });

  it("resolveManifestClaim resolves the generic lens.<kind>.<verb> convention via register(\"lens\", verb)", () => {
    const pairs = new Map([["lens list", { file: "x", line: 1 }]]);
    const hit = resolveManifestClaim("lens.world.list", pairs);
    assert.equal(hit.resolved, true);
    assert.equal(hit.domain, "lens");
    assert.equal(hit.name, "list");
    assert.equal(hit.viaGenericLens, true);
  });

  it("resolveManifestClaim flags lens.<kind>.<customVerb> when the trailing segment isn't a reserved CRUD verb (the real training-room bug shape)", () => {
    const pairs = new Map([["lens list", { file: "x", line: 1 }], ["training-room list_skills", { file: "y", line: 1 }]]);
    // The manifest wrote "lens.training-room.list_skills" instead of
    // "training-room.list_skills" — register("lens","list_skills") does NOT
    // exist (only register("training-room","list_skills") does), so this
    // must be flagged even though a DIFFERENTLY-shaped pair with the same
    // trailing name exists under a different domain.
    const miss = resolveManifestClaim("lens.training-room.list_skills", pairs);
    assert.equal(miss.resolved, false);
    assert.equal(miss.domain, "lens");
    assert.equal(miss.name, "list_skills");
  });

  it("resolveManifestClaim reports domain:null (uncheckable) for a dot-less claim", () => {
    const r = resolveManifestClaim("nodothere", new Map());
    assert.equal(r.domain, null);
    assert.equal(r.resolved, false);
  });
});

/** Builds a fake repo: server/{server.js, domains/x.js} + concord-frontend manifest.ts. */
async function tmpRepo({ manifestBody, serverJs = "", domainFiles = {} }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lens-manifest-cap-"));
  const domainsDir = path.join(dir, "server", "domains");
  await mkdir(domainsDir, { recursive: true });
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  for (const [name, content] of Object.entries(domainFiles)) {
    await writeFile(path.join(domainsDir, name), content, "utf8");
  }
  const manifestDir = path.join(dir, "concord-frontend", "lib", "lenses");
  await mkdir(manifestDir, { recursive: true });
  await writeFile(path.join(manifestDir, "manifest.ts"), manifestBody, "utf8");
  return dir;
}

describe("lens-manifest-capability detector — synthetic end-to-end", () => {
  it("flags a manifest claim with no real backing macro anywhere in server/", async () => {
    const dir = await tmpRepo({
      manifestBody: `
export const LENS_MANIFESTS = [
  { domain: 'widget', label: 'Widget', macros: { list: 'widget.list', create: 'widget.doesNotExist' }, exports: ['json'], actions: [] },
];
`,
      serverJs: "// no widget registration here\n",
      domainFiles: {
        "widget.js": [
          "export default function registerWidgetMacros(register) {",
          '  register("widget", "list", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
    });
    try {
      const report = await runLensManifestCapabilityDetector({ root: dir });
      assert.equal(report.ok, true);
      const hits = report.findings.filter(
        (f) => f.id === "manifest_macro_unbacked" && f.evidence?.value === "widget.doesNotExist"
      );
      assert.equal(hits.length, 1);
      assert.equal(hits[0].severity, "high");
      // The sibling, real claim must NOT be flagged.
      const falseHit = report.findings.filter((f) => f.evidence?.value === "widget.list");
      assert.equal(falseHit.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag a claim registered via registerLensAction (not just register)", async () => {
    const dir = await tmpRepo({
      manifestBody: `
export const LENS_MANIFESTS = [
  { domain: 'sentinel', label: 'Sentinel', macros: { list: 'sentinel.triage.list' }, exports: ['json'], actions: [] },
];
`,
      serverJs: "// unrelated\n",
      domainFiles: {
        "sentinel.js": [
          "export default function registerSentinelActions(register) {",
          '  const registerLensAction = (domain, action, handler) => register(domain, action, handler);',
          '  registerLensAction("sentinel", "triage.list", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
    });
    try {
      const report = await runLensManifestCapabilityDetector({ root: dir });
      const hits = report.findings.filter((f) => f.id === "manifest_macro_unbacked");
      assert.equal(hits.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag the generic lens.<kind>.<verb> convention when register(\"lens\", verb) exists", async () => {
    const dir = await tmpRepo({
      manifestBody: `
export const LENS_MANIFESTS = [
  { domain: 'world', label: 'World', macros: { list: 'lens.world.list', get: 'lens.world.get' }, exports: ['json'], actions: [] },
];
`,
      serverJs: [
        'register("lens", "list", () => ({ ok: true }));',
        'register("lens", "get", () => ({ ok: true }));',
      ].join("\n"),
      domainFiles: {},
    });
    try {
      const report = await runLensManifestCapabilityDetector({ root: dir });
      const hits = report.findings.filter((f) => f.id === "manifest_macro_unbacked");
      assert.equal(hits.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves macros: {} (empty) contributing zero claims and zero findings", async () => {
    const dir = await tmpRepo({
      manifestBody: `
export const LENS_MANIFESTS = [
  { domain: 'ops-telemetry', label: 'Ops Telemetry', macros: {}, exports: ['json'], actions: [] },
];
`,
      serverJs: "",
      domainFiles: {},
    });
    try {
      const report = await runLensManifestCapabilityDetector({ root: dir });
      const summary = report.findings.find((f) => f.id === "lens_manifest_capability_summary");
      assert.equal(summary.evidence.totalClaims, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns ok:false, reason on a missing root", async () => {
    const report = await runLensManifestCapabilityDetector({ root: null });
    assert.equal(report.ok, false);
    assert.equal(report.reason, "no_root");
  });

  it("returns ok:false, reason when manifest.ts doesn't exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lens-manifest-cap-empty-"));
    try {
      const report = await runLensManifestCapabilityDetector({ root: dir });
      assert.equal(report.ok, false);
      assert.equal(report.reason, "manifest_missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lens-manifest-capability detector — real tree", () => {
  it("the training-room manifest drift this detector found is now fixed, and the whole real manifest is clean (proves the detector catches real drift AND recognizes a real fix, not just synthetic fixtures)", async () => {
    const report = await runLensManifestCapabilityDetector({ root: REPO_ROOT });
    assert.equal(report.ok, true);
    const trainingRoomHits = report.findings.filter(
      (f) => f.id === "manifest_macro_unbacked" && f.evidence?.manifestDomain === "training-room"
    );
    assert.equal(
      trainingRoomHits.length,
      0,
      "training-room's manifest entry was repointed to the real training-room.list_skills/frame_data macros — this must now resolve cleanly"
    );
    const summary = report.findings.find((f) => f.id === "lens_manifest_capability_summary");
    assert.ok(summary.evidence.totalClaims > 1000, "expected the real ~260-lens manifest to yield 1000+ macro claims");
    assert.ok(summary.evidence.checked > 1000, "the vast majority of claims should be checkable (contain a dot)");
    assert.equal(summary.evidence.unbacked, 0, "the real manifest should have zero unbacked macro claims after the training-room fix");
  });
});
