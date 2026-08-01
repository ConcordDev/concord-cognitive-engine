// server/tests/check-orphaned-events-gate.test.js
//
// Real acceptance tests for scripts/check-orphaned-events.mjs — the CI
// ratchet against dead frontend wiring (a `new CustomEvent(...)` dispatch
// with no `addEventListener` / event-router consumer anywhere).
//
// The script derives its scan root from `import.meta.url` (ROOT/../
// concord-frontend) and has no exported functions, so the faithful way to
// exercise its real parsing + orphan-detection + allowlist logic under a
// controlled scenario is to copy the REAL, current script into an isolated
// temp root (its own ALLOWLIST comes along verbatim, letting us prove real
// allowlist entries — not fixture-invented ones — actually suppress the
// gate) alongside synthetic concord-frontend/{app,components,hooks} source
// files, and drive it with execFileSync.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_SCRIPT = path.join(REPO_ROOT, "scripts", "check-orphaned-events.mjs");

function makeTempRoot({ includeOrphan = true, includeAllowlisted = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-orphaned-events-test-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  const FE = path.join(root, "concord-frontend");
  fs.mkdirSync(path.join(FE, "app"), { recursive: true });
  fs.mkdirSync(path.join(FE, "components"), { recursive: true });
  fs.mkdirSync(path.join(FE, "hooks"), { recursive: true });
  fs.mkdirSync(path.join(FE, "lib"), { recursive: true });

  fs.copyFileSync(REAL_SCRIPT, path.join(root, "scripts", "check-orphaned-events.mjs"));

  // A dispatch that IS consumed by a listener in a different file — must
  // never be reported as an orphan.
  fs.writeFileSync(
    path.join(FE, "components", "wired.tsx"),
    `export function Wired() {
  window.dispatchEvent(new CustomEvent('concordia:test-wired'));
}
`
  );
  fs.writeFileSync(
    path.join(FE, "hooks", "use-wired.ts"),
    `export function useWired() {
  window.addEventListener('concordia:test-wired', () => {});
}
`
  );

  // A dispatch inside a comment must NOT be picked up (stripComments).
  fs.writeFileSync(
    path.join(FE, "lib", "commented.ts"),
    `// example: new CustomEvent('concordia:should-not-count')
/* new CustomEvent('concordia:also-should-not-count') */
export const noop = 1;
`
  );

  if (includeOrphan) {
    fs.writeFileSync(
      path.join(FE, "app", "foo.tsx"),
      `export function Foo() {
  window.dispatchEvent(new CustomEvent('concordia:test-orphan'));
}
`
    );
  }

  if (includeAllowlisted) {
    // A REAL entry from the script's own ALLOWLIST (copied verbatim along
    // with the script) — dispatched here with deliberately no listener, to
    // prove the allowlist actually suppresses the gate rather than the
    // gate happening to pass by coincidence.
    fs.writeFileSync(
      path.join(FE, "components", "allowlisted.tsx"),
      `export function AllowlistedDispatch() {
  window.dispatchEvent(new CustomEvent('concordia:wheel-action'));
}
`
    );
  }

  return root;
}

function runGate(root, args = []) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, "scripts", "check-orphaned-events.mjs"), ...args],
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

describe("check-orphaned-events.mjs — clean tree (positive case)", () => {
  it("no orphan present: exit 0, '✓ No new orphaned events.'", () => {
    const root = makeTempRoot({ includeOrphan: false });
    try {
      const res = runGate(root);
      assert.equal(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      assert.match(res.stdout, /No new orphaned events/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("a dispatch consumed by addEventListener in another file is never reported as an orphan", () => {
    const root = makeTempRoot({ includeOrphan: false });
    try {
      const res = runGate(root, ["--list"]);
      assert.equal(res.code, 0);
      assert.doesNotMatch(res.stdout, /concordia:test-wired/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("a dispatch inside a // or /* */ comment is not counted at all (stripComments)", () => {
    const root = makeTempRoot({ includeOrphan: false });
    try {
      const res = runGate(root, ["--list"]);
      assert.equal(res.code, 0);
      assert.doesNotMatch(res.stdout, /concordia:should-not-count/);
      assert.doesNotMatch(res.stdout, /concordia:also-should-not-count/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-orphaned-events.mjs — real orphan (negative case)", () => {
  it("a dispatch with no consumer anywhere fails the gate with exit 1", () => {
    const root = makeTempRoot({ includeOrphan: true });
    try {
      const res = runGate(root);
      assert.equal(res.code, 1, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      assert.match(res.stderr, /New orphaned CustomEvent/);
      assert.match(res.stderr, /concordia:test-orphan/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("--list reports the orphan as NEW without exiting non-zero", () => {
    const root = makeTempRoot({ includeOrphan: true });
    try {
      const res = runGate(root, ["--list"]);
      assert.equal(res.code, 0, "--list is report-only, always exits 0");
      assert.match(res.stdout, /\[NEW \] concordia:test-orphan/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the file:line location of the dispatch", () => {
    const root = makeTempRoot({ includeOrphan: true });
    try {
      const res = runGate(root, ["--list"]);
      assert.match(res.stdout, /concordia:test-orphan\s+\(app\/foo\.tsx:2\)/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-orphaned-events.mjs — real ALLOWLIST entries suppress the gate", () => {
  it("a real allowlisted event ('concordia:wheel-action') with no listener does NOT fail the gate", () => {
    const root = makeTempRoot({ includeOrphan: false, includeAllowlisted: true });
    try {
      const res = runGate(root);
      assert.equal(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      assert.match(res.stdout, /No new orphaned events/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("--list tags the allowlisted orphan 'ok' (not 'NEW')", () => {
    const root = makeTempRoot({ includeOrphan: false, includeAllowlisted: true });
    try {
      const res = runGate(root, ["--list"]);
      assert.match(res.stdout, /\[ok {2}\] concordia:wheel-action/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("an allowlisted orphan alongside a genuinely new orphan still fails the gate (allowlist doesn't blanket-suppress)", () => {
    const root = makeTempRoot({ includeOrphan: true, includeAllowlisted: true });
    try {
      const res = runGate(root);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /concordia:test-orphan/);
      assert.doesNotMatch(res.stderr, /concordia:wheel-action/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check-orphaned-events.mjs — live repo smoke", () => {
  it("runs cleanly against the real repo and produces well-formed --list output", () => {
    const stdout = execFileSync(process.execPath, [REAL_SCRIPT, "--list"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.match(stdout, /Scanned \d+ files/);
    assert.match(stdout, /Orphans: \d+ total, \d+ allowlisted, \d+ new/);
  });
});
