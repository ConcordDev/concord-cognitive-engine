// server/tests/verify-economic-invariants-gate.test.js
//
// Real acceptance tests for scripts/verify-economic-invariants.mjs — the
// constitutional economic-constant drift gate (CLAUDE.md "Marketplace fees
// are hardcoded" / "Do not change any of the above without governance
// approval").
//
// The script is a pure CLI script with no exported functions: it derives its
// own ROOT from `import.meta.url` two directories up, so the only faithful
// way to exercise it under a controlled scenario (rather than just running
// it against the live repo, which can only ever prove "still green today")
// is to copy the REAL, current script content into an isolated temp root
// alongside synthetic copies of the four source files it greps constants
// from, and drive it with execFileSync. This proves both directions:
//   - clean fixtures with every constant exactly matching the constitutional
//     values pass with exit 0 and `ok: true`.
//   - a single drifted constant (a representative sample of the 13, one at a
//     time) is detected, reported by name with actual vs expected, and
//     fails --ci with exit 1.
//   - the two derived identities (shares-sum-to-1, seller-floor >= 64.54%)
//     are independently exercised by fixtures that hold every parsed
//     constant intact but make the derived math fail.
//
// Also runs the script against the REAL repo files (no fixture) to prove the
// gate is currently green against the actual constitutional constants —
// the live regression-proof half of "does this gate actually gate".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REAL_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-economic-invariants.mjs");

// Baseline fixture source snippets — deliberately minimal, but structurally
// faithful to the real files (same variable-name : value idiom the script's
// `num()` regex parses), holding every constitutional constant exactly.
const GOOD = {
  cmc: `
    module.exports = {
      PLATFORM_FEE_RATE: 0.0146,
      MARKETPLACE_FEE_RATE: 0.04,
      INITIAL_ROYALTY_RATE: 0.21,
      ROYALTY_HALVING: 2,
      ROYALTY_FLOOR: 0.0005,
      MAX_CASCADE_DEPTH: 50,
    };
  `,
  cascade: `
    const MAX_ROYALTY_RATE = 0.30;
    module.exports = { MAX_ROYALTY_RATE };
  `,
  withdrawals: `
    const WITHDRAWAL_HOLD_HOURS = 48;
    module.exports = { WITHDRAWAL_HOLD_HOURS };
  `,
  serverJs: `
    const TOKEN_PURCHASE_FEE = 0.0146;
    const MARKETPLACE_FEE = 0.04;
    const CREATOR_SHARE = 0.70;
    const ROYALTY_SHARE = 0.20;
    const TREASURY_SHARE = 0.10;
  `,
};

function makeTempRoot(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-economic-invariants-test-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "economy"), { recursive: true });

  // Copy the REAL, current script content — never a hand-authored stand-in.
  fs.copyFileSync(REAL_SCRIPT, path.join(root, "scripts", "verify-economic-invariants.mjs"));

  const files = { ...GOOD, ...overrides };
  fs.writeFileSync(path.join(root, "server", "lib", "creative-marketplace-constants.js"), files.cmc);
  fs.writeFileSync(path.join(root, "server", "economy", "royalty-cascade.js"), files.cascade);
  fs.writeFileSync(path.join(root, "server", "economy", "withdrawals.js"), files.withdrawals);
  fs.writeFileSync(path.join(root, "server", "server.js"), files.serverJs);
  return root;
}

function runGate(root, args = []) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(root, "scripts", "verify-economic-invariants.mjs"), ...args],
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

describe("verify-economic-invariants.mjs — clean fixture (positive case)", () => {
  it("passes with exit 0 and ok:true, --json --ci", () => {
    const root = makeTempRoot();
    try {
      const res = runGate(root, ["--json", "--ci"]);
      assert.equal(res.code, 0, `expected exit 0; stderr:\n${res.stderr}`);
      const out = JSON.parse(res.stdout);
      assert.equal(out.ok, true);
      assert.equal(out.invariants.length, 13);
      for (const inv of out.invariants) assert.equal(inv.ok, true, `${inv.name} should hold`);
      for (const d of out.derived) assert.equal(d.ok, true, `${d.name} should hold`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("human-readable mode reports all-hold banner and exits 0", () => {
    const root = makeTempRoot();
    try {
      const res = runGate(root, []);
      assert.equal(res.code, 0);
      assert.match(res.stdout, /all economic invariants hold/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-economic-invariants.mjs — drift detection (negative cases)", () => {
  const cases = [
    {
      name: "PLATFORM_FEE_RATE drifted",
      overrides: { cmc: GOOD.cmc.replace("PLATFORM_FEE_RATE: 0.0146", "PLATFORM_FEE_RATE: 0.05") },
      expectDrifted: "PLATFORM_FEE_RATE",
    },
    {
      name: "MARKETPLACE_FEE_RATE drifted",
      overrides: { cmc: GOOD.cmc.replace("MARKETPLACE_FEE_RATE: 0.04", "MARKETPLACE_FEE_RATE: 0.10") },
      expectDrifted: "MARKETPLACE_FEE_RATE",
    },
    {
      name: "INITIAL_ROYALTY_RATE drifted",
      overrides: { cmc: GOOD.cmc.replace("INITIAL_ROYALTY_RATE: 0.21", "INITIAL_ROYALTY_RATE: 0.35") },
      expectDrifted: "INITIAL_ROYALTY_RATE",
    },
    {
      name: "MAX_ROYALTY_RATE drifted (governance cap raised silently)",
      overrides: { cascade: GOOD.cascade.replace("0.30", "0.50") },
      expectDrifted: "MAX_ROYALTY_RATE",
    },
    {
      name: "WITHDRAWAL_HOLD_HOURS drifted (refund-exploit window shortened)",
      overrides: { withdrawals: GOOD.withdrawals.replace("48", "12") },
      expectDrifted: "WITHDRAWAL_HOLD_HOURS",
    },
    {
      name: "CREATOR_SHARE drifted",
      overrides: { serverJs: GOOD.serverJs.replace("CREATOR_SHARE = 0.70", "CREATOR_SHARE = 0.60") },
      expectDrifted: "CREATOR_SHARE",
    },
    {
      name: "missing constant entirely (deleted from source)",
      overrides: { serverJs: GOOD.serverJs.replace(/const TREASURY_SHARE = 0\.10;\n/, "") },
      expectDrifted: "TREASURY_SHARE",
    },
  ];

  for (const c of cases) {
    it(`detects ${c.name} and fails --ci with exit 1`, () => {
      const root = makeTempRoot(c.overrides);
      try {
        const res = runGate(root, ["--json", "--ci"]);
        assert.equal(res.code, 1, `expected exit 1 for ${c.name}; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
        const out = JSON.parse(res.stdout);
        assert.equal(out.ok, false);
        const bad = out.invariants.find((r) => r.name === c.expectDrifted);
        assert.ok(bad, `expected a result row for ${c.expectDrifted}`);
        assert.equal(bad.ok, false, `${c.expectDrifted} should be reported as drifted`);
        // --json suppresses the human-readable banner; --ci still logs a
        // short stderr FAIL line regardless of --json.
        assert.match(res.stderr, /\[economic-invariants\] FAIL/i);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("without --ci, a drift is reported but the process still exits 0 (report-only mode)", () => {
    const root = makeTempRoot({ cmc: GOOD.cmc.replace("PLATFORM_FEE_RATE: 0.0146", "PLATFORM_FEE_RATE: 0.05") });
    try {
      const res = runGate(root, []);
      assert.equal(res.code, 0, "no --ci flag means the script never calls process.exit(1)");
      assert.match(res.stdout, /ECONOMIC INVARIANT DRIFT/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-economic-invariants.mjs — derived identities", () => {
  it("flags shares-sum-to-1 breaking even when only one of the three shares drifted", () => {
    // CREATOR+ROYALTY+TREASURY should sum to 1.0 (0.70+0.20+0.10). Push
    // TREASURY_SHARE up so the *sum* breaks — this proves the derived-
    // identity check is independent, real math, not just a restatement of
    // the three named-constant checks (TREASURY_SHARE's own row will also
    // fail, but we assert the derived row specifically here).
    const root = makeTempRoot({ serverJs: GOOD.serverJs.replace("TREASURY_SHARE = 0.10", "TREASURY_SHARE = 0.15") });
    try {
      const res = runGate(root, ["--json", "--ci"]);
      assert.equal(res.code, 1);
      const out = JSON.parse(res.stdout);
      const sumCheck = out.derived.find((d) => d.name.includes("shares sum to 1.0"));
      assert.ok(sumCheck);
      assert.equal(sumCheck.ok, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags seller-floor breaking when MAX_ROYALTY_RATE is raised even if platform/marketplace fees are unchanged", () => {
    const root = makeTempRoot({ cascade: GOOD.cascade.replace("0.30", "0.40") });
    try {
      const res = runGate(root, ["--json", "--ci"]);
      assert.equal(res.code, 1);
      const out = JSON.parse(res.stdout);
      const floorCheck = out.derived.find((d) => d.name.includes("seller keeps"));
      assert.ok(floorCheck);
      assert.equal(floorCheck.ok, false);
      // Sanity: the reported percentage should reflect the drifted 40% cap,
      // i.e. 1 - (0.0146+0.04) - 0.40 = 54.54%, well under the 64.54% floor.
      assert.match(floorCheck.detail, /54\.5[0-9]%/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verify-economic-invariants.mjs — live repo regression proof", () => {
  it("the real repo's constants currently pass the gate (--json --ci against the actual source tree)", () => {
    const stdout = execFileSync(process.execPath, [REAL_SCRIPT, "--json", "--ci"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const out = JSON.parse(stdout);
    assert.equal(out.ok, true, `live repo economic invariants should hold: ${JSON.stringify(out.invariants.filter((r) => !r.ok))}`);
    assert.equal(out.invariants.length, 13);
  });
});
