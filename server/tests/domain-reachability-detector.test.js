// server/tests/domain-reachability-detector.test.js
//
// OP4 (2026-07-23) — pinning test for the domain-reachability detector, the
// generalized/permanent version of the manual wiring audit that found 5
// fully-coded, fully-tested domain files (immersive-sim, skill-tree,
// sports-careers, survival, vehicle-tuning — Phase II Waves 15-27) whose
// `registerXMacros(register)` default export was never imported by server.js
// OR domains/index.js, so every macro they registered was unreachable at
// runtime. Fixed in commit 61a29cc0 (see server.js's "Wiring-audit fix
// (2026-07-23)" comment block right after the Literary Resonance Lattice
// import).
//
// Bidirectional correctness (CLAUDE.md's anti-cheat rule):
//   1. Real flag — a synthetic domain file with a real default-export
//      registrar that is imported by NEITHER server.js NOR domains/index.js
//      is flagged `domain_registrar_unreachable` (high).
//   2. No false positive — a domain file that's wired via the server.js
//      2-line `import + call` pattern, one wired via inclusion in
//      domains/index.js's exported array, AND (the regression this test
//      pins) a file whose ONLY mention of "export default function
//      registerXMacros(register) {" is inside a `//` doc-comment showing
//      callers how to use a factory it exports by NAME — must NOT be
//      misclassified as an unreachable registrar. This exact shape is real
//      in the tree today: server/domains/_dtu-recent-mine.js and
//      server/domains/_recent-mine-helper.js both have a commented usage
//      example reading "export default function register<X>Macros(register) {"
//      that a naive (non-comment-aware) regex match mis-flagged as a real,
//      unreachable default export before this fix.
//   3. Real-tree check — run against the actual repo root and assert ZERO
//      `domain_registrar_unreachable` (high) findings, i.e. the 5 domains
//      fixed by 61a29cc0 stay fixed and no new one has regressed in.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDomainReachabilityDetector } from "../lib/detectors/domain-reachability-detector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

/** Builds a fake repo with a server/domains/ tree + server/server.js + server/domains/index.js. */
async function tmpRepo(domainFiles, { serverJs = "", indexJs = "" } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "domain-reach-"));
  const domainsDir = path.join(dir, "server", "domains");
  await mkdir(domainsDir, { recursive: true });
  for (const [name, content] of Object.entries(domainFiles)) {
    await writeFile(path.join(domainsDir, name), content, "utf8");
  }
  await writeFile(path.join(dir, "server", "server.js"), serverJs, "utf8");
  await writeFile(path.join(domainsDir, "index.js"), indexJs, "utf8");
  return dir;
}

function findingIds(report) {
  return report.findings.map((f) => f.id);
}

function highFindingsFor(report, fileName) {
  return report.findings.filter(
    (f) => f.id === "domain_registrar_unreachable" && f.evidence?.file === `server/domains/${fileName}`
  );
}

describe("domain-reachability detector — synthetic fixtures", () => {
  it("flags a real orphan registrar (default export, no import anywhere)", async () => {
    const dir = await tmpRepo(
      {
        "orphan-domain.js": [
          "export default function registerOrphanMacros(register) {",
          '  register("orphan", "ping", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
      { serverJs: "// no import of orphan-domain.js here\n", indexJs: "export default [];\n" }
    );
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      assert.equal(report.ok, true);
      const hits = highFindingsFor(report, "orphan-domain.js");
      assert.equal(hits.length, 1, "orphan registrar must be flagged exactly once");
      assert.equal(hits[0].severity, "high");
      assert.equal(hits[0].fixHint, "import_and_call_registrar_or_add_to_domains_index");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag a registrar wired via the server.js import+call pattern", async () => {
    const dir = await tmpRepo(
      {
        "wired-via-server.js": [
          "export default function registerWiredMacros(register) {",
          '  register("wired", "ping", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
      {
        serverJs: [
          'import registerWiredMacros from "./domains/wired-via-server.js";',
          "registerWiredMacros(register);",
        ].join("\n"),
        indexJs: "export default [];\n",
      }
    );
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      assert.equal(highFindingsFor(report, "wired-via-server.js").length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT flag a registrar wired via domains/index.js's exported array", async () => {
    const dir = await tmpRepo(
      {
        "wired-via-index.js": [
          "export default function registerIndexMacros(register) {",
          '  register("indexed", "ping", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
      {
        serverJs: "// unrelated\n",
        indexJs: [
          'import wiredViaIndex from "./wired-via-index.js";',
          "export default [",
          "  wiredViaIndex,",
          "];",
        ].join("\n"),
      }
    );
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      assert.equal(highFindingsFor(report, "wired-via-index.js").length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("REGRESSION: a doc-comment showing 'export default function registerXMacros(register) {' as a usage example for a NAMED-export factory must not be misread as a real, unreachable default export", async () => {
    // Mirrors the real shape of server/domains/_dtu-recent-mine.js (still
    // live, consumed by _recent-mine-bulk.js): no real default export, a
    // named factory export, and a `//` comment block showing a caller how
    // to wrap it in their own `export default function registerXMacros(register) {`.
    // (The sibling non-DTU generic factory this comment used to cite,
    // server/domains/_recent-mine-helper.js, was itself flagged as
    // genuinely dead — zero real domain consumers, only its own unit test —
    // by the domain-reachability detector's `domain_helper_unreachable`
    // check, and was removed rather than force-adopted into a domain whose
    // response shape didn't match. This synthetic fixture below preserves
    // the regression coverage independent of that file's existence.)
    const helperFile = [
      "// Usage in a domain file:",
      "//",
      '//   import { buildThingMacro } from "./_helper-factory.js";',
      "//",
      "//   export default function registerFooMacros(register) {",
      '//     buildThingMacro(register, "foo");',
      "//   }",
      "",
      "export function buildThingMacro(register, domain) {",
      '  register(domain, "recent_mine", async () => ({ ok: true }));',
      "}",
    ].join("\n");
    const consumerFile = [
      'import { buildThingMacro } from "./_helper-factory.js";',
      "export default function registerFooMacros(register) {",
      '  buildThingMacro(register, "foo");',
      "}",
    ].join("\n");
    const dir = await tmpRepo(
      {
        "_helper-factory.js": helperFile,
        "foo-domain.js": consumerFile,
      },
      {
        serverJs: [
          'import registerFooMacros from "./domains/foo-domain.js";',
          "registerFooMacros(register);",
        ].join("\n"),
        indexJs: "export default [];\n",
      }
    );
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      // The helper must be classified as a helper (no default export) and
      // must be considered REACHED because foo-domain.js imports it by name
      // — never flagged as an unreachable "registrar".
      assert.equal(
        highFindingsFor(report, "_helper-factory.js").length,
        0,
        "comment-only mention of 'export default function' must not count as a real export"
      );
      const helperFindings = report.findings.filter(
        (f) => f.id === "domain_helper_unreachable" && f.evidence?.file === "server/domains/_helper-factory.js"
      );
      assert.equal(helperFindings.length, 0, "the helper IS referenced by foo-domain.js — must not be flagged unreachable");
      // And the real registrar (foo-domain.js) is correctly wired.
      assert.equal(highFindingsFor(report, "foo-domain.js").length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("flags a genuinely unreferenced helper module (no default export, never imported anywhere)", async () => {
    const dir = await tmpRepo(
      {
        "_dead-helper.js": [
          "export function neverCalled(register) {",
          '  register("dead", "ping", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
      { serverJs: "// no reference\n", indexJs: "export default [];\n" }
    );
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      const hits = report.findings.filter(
        (f) => f.id === "domain_helper_unreachable" && f.evidence?.file === "server/domains/_dead-helper.js"
      );
      assert.equal(hits.length, 1);
      assert.equal(hits[0].severity, "low");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns a summary finding with accurate counts", async () => {
    const dir = await tmpRepo(
      {
        "wired.js": [
          "export default function registerWiredMacros(register) {",
          '  register("wired", "ping", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
        "orphan.js": [
          "export default function registerOrphanMacros(register) {",
          '  register("orphan", "ping", async () => ({ ok: true }));',
          "}",
        ].join("\n"),
      },
      {
        serverJs: [
          'import registerWiredMacros from "./domains/wired.js";',
          "registerWiredMacros(register);",
        ].join("\n"),
        indexJs: "export default [];\n",
      }
    );
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      const summary = report.findings.find((f) => f.id === "domain_reachability_summary");
      assert.ok(summary);
      assert.equal(summary.evidence.totalFiles, 2);
      assert.equal(summary.evidence.registrarCount, 2);
      assert.equal(summary.evidence.unreachableRegistrars, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns ok:false, reason on a missing root", async () => {
    const report = await runDomainReachabilityDetector({ root: null });
    assert.equal(report.ok, false);
    assert.equal(report.reason, "no_root");
  });

  it("returns ok:false, reason when server/domains doesn't exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "domain-reach-empty-"));
    try {
      const report = await runDomainReachabilityDetector({ root: dir });
      assert.equal(report.ok, false);
      assert.equal(report.reason, "domains_dir_missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("domain-reachability detector — real tree", () => {
  it("reports ZERO unreachable registrars against the current repo (the 5 domains fixed by 61a29cc0 stay fixed)", async () => {
    const report = await runDomainReachabilityDetector({ root: REPO_ROOT });
    assert.equal(report.ok, true);
    const highRegistrarFindings = report.findings.filter((f) => f.id === "domain_registrar_unreachable");
    assert.deepEqual(
      highRegistrarFindings.map((f) => f.evidence?.file),
      [],
      "no server/domains/*.js registrar should be unreachable on the current tree"
    );
    // Sanity: the detector actually walked a realistically large tree (not a
    // degenerate 0-file run that would trivially "pass").
    const summary = report.findings.find((f) => f.id === "domain_reachability_summary");
    assert.ok(summary.evidence.totalFiles > 300, "expected the real ~400-file domains/ tree to be scanned");
    assert.ok(summary.evidence.registrarCount > 300, "expected the vast majority to be real registrars");
  });
});
