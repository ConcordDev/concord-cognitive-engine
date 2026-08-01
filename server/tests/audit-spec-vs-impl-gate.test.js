// server/tests/audit-spec-vs-impl-gate.test.js
//
// Real acceptance tests for scripts/audit-spec-vs-impl.mjs — the spec-prose
// vs macro-implementation mismatch auditor (catches e.g. a lens spec
// claiming "real-time" for a macro that's actually poll-shaped with no
// realtimeEmit, or claiming an external integration for a macro with no
// external fetch).
//
// Entirely filesystem-based (no live server, no browser): it walks a
// `server/` tree indexing `register(...)`/`registerLensAction(...)` handler
// bodies, walks `docs/lens-specs/*.md`, and cross-references spec-claim
// keywords against handler-body signals. The script has no exported
// functions and derives SPECS/SERVER from `import.meta.url`, so the
// faithful way to exercise its real regex-based body-extraction + paragraph-
// scoped claim-classification logic is to copy the REAL, current script
// into an isolated temp root with a small, hand-designed fixture tree, and
// drive it with execFileSync.
//
// Fixture design (`mylens` domain, 4 macros):
//   - liveFeed        — spec paragraph claims "real-time"/"pushed live";
//                        body polls (setInterval + `since`), no realtimeEmit.
//                        => POLLING-WHERE-REALTIME-CLAIMED (mismatch).
//   - goodRealtime     — spec claims "real-time"/"live socket"; body DOES
//                        call realtimeEmit. => no mismatch.
//   - integrateGithub — spec claims "GitHub API" integration; body is a
//                        short stub with no external fetch.
//                        => STUB-WHERE-INTEGRATION-CLAIMED (mismatch).
//   - realGithub       — spec claims "GitHub API"; body has a real
//                        `await fetch('https://api.github.com/...')`.
//                        => no mismatch.
// A second `cleanlens` domain/spec with no claim keywords at all proves a
// clean spec contributes zero findings. A `README.md` in the same specs
// directory (excluded by the script's own specsList() filter) proves the
// exclusion holds.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_SCRIPT = path.join(REPO_ROOT, "scripts", "audit-spec-vs-impl.mjs");

const MYLENS_DOMAIN_JS = `
export default function registerMylensActions(register) {
  register("mylens", "liveFeed", (ctx, artifact, params) => {
    const since = params.since;
    setInterval(() => {}, 1000);
    return { ok: true, since };
  });

  register("mylens", "goodRealtime", (ctx, artifact, params) => {
    realtimeEmit("mylens:update", {});
    return { ok: true };
  });

  register("mylens", "integrateGithub", (ctx, artifact, params) => {
    return { ok: true, note: "not yet wired" };
  });

  register("mylens", "realGithub", async (ctx, artifact, params) => {
    const r = await fetch('https://api.github.com/repos/foo/bar');
    const data = await r.json();
    return { ok: true, data };
  });
}
`;

const MYLENS_SPEC_MD = `# Mylens

## Missing

- [ ] \`[L]\` Add real-time updates via \`mylens.liveFeed\` — currently polls every second, should be pushed live.

- [ ] \`[M]\` \`mylens.goodRealtime\` streams updates in real-time over a live socket connection.

- [ ] \`[M]\` This macro should integrate with the GitHub API to sync issues: \`mylens.integrateGithub\`.

- [ ] \`[M]\` \`mylens.realGithub\` integrates with the GitHub API for real data sync.
`;

const CLEANLENS_DOMAIN_JS = `
export default function registerCleanlensActions(register) {
  register("cleanlens", "listThings", (ctx, artifact, params) => {
    return { ok: true, things: [] };
  });
}
`;

const CLEANLENS_SPEC_MD = `# Cleanlens

## Missing

- [x] \`[S]\` \`cleanlens.listThings\` returns the user's saved things.
`;

const README_MD = `# Lens specs index

This directory holds per-lens capability specs. Not itself a spec.
Mentions \`mylens.liveFeed\` here should never be scanned — README.md is
excluded by specsList().
`;

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-spec-vs-impl-test-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "lens-specs"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "domains"), { recursive: true });

  fs.copyFileSync(REAL_SCRIPT, path.join(root, "scripts", "audit-spec-vs-impl.mjs"));

  fs.writeFileSync(path.join(root, "server", "domains", "mylens.js"), MYLENS_DOMAIN_JS);
  fs.writeFileSync(path.join(root, "server", "domains", "cleanlens.js"), CLEANLENS_DOMAIN_JS);
  fs.writeFileSync(path.join(root, "docs", "lens-specs", "mylens.md"), MYLENS_SPEC_MD);
  fs.writeFileSync(path.join(root, "docs", "lens-specs", "cleanlens.md"), CLEANLENS_SPEC_MD);
  fs.writeFileSync(path.join(root, "docs", "lens-specs", "README.md"), README_MD);

  return root;
}

function runAudit(root) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, "scripts", "audit-spec-vs-impl.mjs")],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("audit-spec-vs-impl.mjs — detects real mismatches", () => {
  it("exits 0 (report-only script — never fails CI on its own) and writes the JSON report", () => {
    const root = makeTempRoot();
    try {
      const res = runAudit(root);
      assert.equal(res.code, 0, `stderr:\n${res.stderr}`);
      const outPath = path.join(root, "audit", "spec-vs-impl.json");
      assert.ok(fs.existsSync(outPath), "expected audit/spec-vs-impl.json to be written");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("README.md is excluded from specsList() (2 real specs scanned, not 3)", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const out = JSON.parse(fs.readFileSync(path.join(root, "audit", "spec-vs-impl.json"), "utf8"));
      assert.equal(out.totals.specs, 2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags liveFeed as POLLING-WHERE-REALTIME-CLAIMED", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const out = JSON.parse(fs.readFileSync(path.join(root, "audit", "spec-vs-impl.json"), "utf8"));
      const m = out.mismatches.find((x) => x.macro === "mylens.liveFeed");
      assert.ok(m, `expected a mismatch for mylens.liveFeed; got: ${JSON.stringify(out.mismatches)}`);
      assert.equal(m.category, "POLLING-WHERE-REALTIME-CLAIMED");
      assert.match(m.file, /server[/\\]domains[/\\]mylens\.js$/);
      assert.equal(m.evidence.hasRealtimeEmit, false);
      assert.equal(m.evidence.looksPolling, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT flag goodRealtime — it genuinely calls realtimeEmit", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const out = JSON.parse(fs.readFileSync(path.join(root, "audit", "spec-vs-impl.json"), "utf8"));
      const m = out.mismatches.find((x) => x.macro === "mylens.goodRealtime");
      assert.equal(m, undefined, "goodRealtime should not be flagged — it has a real realtimeEmit call");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags integrateGithub as STUB-WHERE-INTEGRATION-CLAIMED", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const out = JSON.parse(fs.readFileSync(path.join(root, "audit", "spec-vs-impl.json"), "utf8"));
      const m = out.mismatches.find((x) => x.macro === "mylens.integrateGithub");
      assert.ok(m, `expected a mismatch for mylens.integrateGithub; got: ${JSON.stringify(out.mismatches)}`);
      assert.equal(m.category, "STUB-WHERE-INTEGRATION-CLAIMED");
      assert.equal(m.evidence.hasExternalFetch, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT flag realGithub — it genuinely fetches https://api.github.com", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const out = JSON.parse(fs.readFileSync(path.join(root, "audit", "spec-vs-impl.json"), "utf8"));
      const m = out.mismatches.find((x) => x.macro === "mylens.realGithub");
      assert.equal(m, undefined, "realGithub should not be flagged — it has a real external fetch");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("totals + byCategory + byLens are internally consistent: exactly 2 mismatches, both under mylens", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const out = JSON.parse(fs.readFileSync(path.join(root, "audit", "spec-vs-impl.json"), "utf8"));
      assert.equal(out.totals.mismatches, 2);
      assert.equal(out.totals.byCategory["POLLING-WHERE-REALTIME-CLAIMED"], 1);
      assert.equal(out.totals.byCategory["STUB-WHERE-INTEGRATION-CLAIMED"], 1);
      assert.equal(out.byLens.mylens.length, 2);
      assert.equal(out.byLens.cleanlens, undefined, "a spec with no mismatches has no byLens entry");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a human-readable markdown report naming the mismatches", () => {
    const root = makeTempRoot();
    try {
      runAudit(root);
      const md = fs.readFileSync(path.join(root, "audit", "spec-vs-impl-mismatches.md"), "utf8");
      assert.match(md, /mylens\.liveFeed/);
      assert.match(md, /mylens\.integrateGithub/);
      assert.match(md, /POLLING-WHERE-REALTIME-CLAIMED/);
      assert.match(md, /STUB-WHERE-INTEGRATION-CLAIMED/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("audit-spec-vs-impl.mjs — live repo smoke", () => {
  // The real script writes audit/spec-vs-impl.json + audit/spec-vs-impl-
  // mismatches.md relative to ROOT (its own real location) — both are
  // tracked, committed files, so this smoke test snapshots and restores
  // them (CLAUDE.md: transient regenerated artifacts are checkout-reverted
  // after a suite run, never left dirty / never committed as a side effect
  // of testing).
  const jsonPath = path.join(REPO_ROOT, "audit", "spec-vs-impl.json");
  const mdPath = path.join(REPO_ROOT, "audit", "spec-vs-impl-mismatches.md");
  let jsonBefore;
  let mdBefore;

  it("runs cleanly against the real repo and produces a well-formed report", () => {
    jsonBefore = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : null;
    mdBefore = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, "utf8") : null;
    try {
      const res = spawnSync(process.execPath, [REAL_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      assert.equal(res.status, 0, `stderr:\n${res.stderr}`);
      assert.match(res.stderr, /Auditing \d+ spec files/);
      assert.match(res.stderr, /Total mismatches: \d+/);
      const out = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      assert.ok(out.totals.specs > 0);
      assert.ok(Array.isArray(out.mismatches));
    } finally {
      if (jsonBefore != null) fs.writeFileSync(jsonPath, jsonBefore);
      if (mdBefore != null) fs.writeFileSync(mdPath, mdBefore);
    }
  });
});
