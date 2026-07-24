// server/tests/scaffold-lens.test.js
//
// Acceptance tests for scripts/scaffold-lens.mjs (the lens scaffolder).
//
// IMPORTANT: every test here runs the scaffolder against an ISOLATED temp
// directory via --root, and copies in only the two small registry files it
// edits (server/lib/lens-manifest.js, server/lib/lens-features-extended.js).
// The real repo's copies of those files, and the real
// concord-frontend/app/lenses/ directory, are never passed to the script
// and are asserted untouched at the end. This is deliberate: the scaffolder
// must never register a fake "test lens" into the live product as a side
// effect of running this test suite.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "scaffold-lens.mjs");

const REAL_MANIFEST = path.join(REPO_ROOT, "server", "lib", "lens-manifest.js");
const REAL_FEATURES = path.join(REPO_ROOT, "server", "lib", "lens-features.js");
const REAL_EXTENDED_FEATURES = path.join(REPO_ROOT, "server", "lib", "lens-features-extended.js");

/**
 * Builds a throwaway root with the registry files the scaffolder reads
 * and/or edits copied in: lens-manifest.js (edited), lens-features.js
 * (read-only, scanned for the current max lensNumber), and
 * lens-features-extended.js (edited). Copying all three is what makes the
 * isolated root a truthful mirror of what nextLensNumber() scans in the
 * real repo — omitting lens-features.js would let the isolated root
 * under-count the real max lensNumber (server/lib/lens-features.js alone
 * contains entries past 100, e.g. lensNumber 128).
 */
function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-lens-test-"));
  fs.mkdirSync(path.join(root, "server", "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "server", "domains"), { recursive: true });
  fs.mkdirSync(path.join(root, "concord-frontend", "app", "lenses"), { recursive: true });
  fs.copyFileSync(REAL_MANIFEST, path.join(root, "server", "lib", "lens-manifest.js"));
  fs.copyFileSync(REAL_FEATURES, path.join(root, "server", "lib", "lens-features.js"));
  fs.copyFileSync(REAL_EXTENDED_FEATURES, path.join(root, "server", "lib", "lens-features-extended.js"));
  return root;
}

function runScaffolder(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

test("scaffolds a throwaway lens end-to-end into an isolated temp root", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["zzz-throwaway-lens", "ZZZ Throwaway Lens", "SPECIALIZED", "--root", root]);
  assert.equal(res.code, 0, `scaffolder should exit 0; stderr:\n${res.stderr}`);

  const domainFile = path.join(root, "server", "domains", "zzz-throwaway-lens.js");
  const pageFile = path.join(root, "concord-frontend", "app", "lenses", "zzz-throwaway-lens", "page.tsx");

  assert.ok(fs.existsSync(domainFile), "domain file should be written");
  assert.ok(fs.existsSync(pageFile), "page.tsx should be written");

  // Syntactic validity of the generated domain file — a real syntax check,
  // not a string-contains assertion.
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", domainFile], { stdio: "pipe" });
  }, "generated domain file must pass `node --check`");

  // The domain file must follow the register(domain, action, handler, spec)
  // pattern used by every real server/domains/*.js file, and must NOT be a
  // bare TODO stub.
  const domainSrc = fs.readFileSync(domainFile, "utf8");
  assert.match(domainSrc, /export default function registerZzzThrowawayLensMacros\(register\)/);
  assert.match(domainSrc, /register\("zzz-throwaway-lens", "echo", async/);
  assert.match(domainSrc, /register\("zzz-throwaway-lens", "counter", async/);
  // Look for an actual TODO-marker comment (e.g. "// TODO: implement"),
  // not just the word "TODO" — the file's own honesty header legitimately
  // says "not TODO placeholders" in prose, which a bare substring check
  // would wrongly flag.
  assert.doesNotMatch(domainSrc, /\/\/\s*TODO\b/i, "generated macro must be real, not a TODO placeholder");

  // The page must be parseable-shaped: real imports of the established
  // substrate primitives (LensShell + ManifestActionBar), a real lensRun
  // call wired to the scaffolded macros, and NOT a generic button-wall
  // (no <UniversalActions> / <LensFeaturePanel>).
  const pageSrc = fs.readFileSync(pageFile, "utf8");
  assert.match(pageSrc, /'use client';/);
  assert.match(pageSrc, /import \{ LensShell \} from '@\/components\/lens\/LensShell';/);
  assert.match(pageSrc, /import \{ ManifestActionBar \} from '@\/components\/lens\/ManifestActionBar';/);
  assert.match(pageSrc, /import \{ lensRun \} from '@\/lib\/api\/client';/);
  assert.match(pageSrc, /lensRun<EchoResult>\('zzz-throwaway-lens', 'echo'/);
  assert.match(pageSrc, /lensRun<CounterResult>\('zzz-throwaway-lens', 'counter'/);
  assert.match(pageSrc, /<LensShell lensId="zzz-throwaway-lens">/);
  assert.doesNotMatch(pageSrc, /<UniversalActions/);
  assert.doesNotMatch(pageSrc, /<LensFeaturePanel/);
  // Balanced braces is a cheap structural parse proxy without pulling in a
  // TSX parser dependency for this test.
  const opens = (pageSrc.match(/\{/g) || []).length;
  const closes = (pageSrc.match(/\}/g) || []).length;
  assert.equal(opens, closes, "page.tsx braces should balance");

  // Registry edits: both files must still be syntactically valid JS, and
  // must contain the new entry.
  const manifestFile = path.join(root, "server", "lib", "lens-manifest.js");
  const extendedFile = path.join(root, "server", "lib", "lens-features-extended.js");
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", manifestFile], { stdio: "pipe" }));
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", extendedFile], { stdio: "pipe" }));
  assert.match(fs.readFileSync(manifestFile, "utf8"), /zzz-throwaway-lens: \[/);
  assert.match(fs.readFileSync(extendedFile, "utf8"), /zzz-throwaway-lens: \{/);

  // The real repo files must be completely untouched by this test run.
  const realManifestSrc = fs.readFileSync(REAL_MANIFEST, "utf8");
  const realFeaturesSrc = fs.readFileSync(REAL_FEATURES, "utf8");
  const realExtendedSrc = fs.readFileSync(REAL_EXTENDED_FEATURES, "utf8");
  assert.doesNotMatch(realManifestSrc, /zzz-throwaway-lens/);
  assert.doesNotMatch(realFeaturesSrc, /zzz-throwaway-lens/);
  assert.doesNotMatch(realExtendedSrc, /zzz-throwaway-lens/);
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, "server", "domains", "zzz-throwaway-lens.js")));
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, "concord-frontend", "app", "lenses", "zzz-throwaway-lens")));
});

test("refuses to overwrite an existing domain file without --force", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = runScaffolder(["dupe-lens", "Dupe Lens", "SPECIALIZED", "--root", root]);
  assert.equal(first.code, 0);

  const second = runScaffolder(["dupe-lens", "Dupe Lens", "SPECIALIZED", "--root", root]);
  assert.equal(second.code, 1, "second run without --force must fail");
  assert.match(second.stderr, /refusing to overwrite/);
});

test("--force + re-run is idempotent on the registry entries (no duplicate keys)", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  runScaffolder(["idempotent-lens", "Idempotent Lens", "SPECIALIZED", "--root", root]);
  const second = runScaffolder(["idempotent-lens", "Idempotent Lens", "SPECIALIZED", "--root", root, "--force"]);
  assert.equal(second.code, 0, `re-run with --force should succeed; stderr:\n${second.stderr}`);

  const manifestSrc = fs.readFileSync(path.join(root, "server", "lib", "lens-manifest.js"), "utf8");
  const extendedSrc = fs.readFileSync(path.join(root, "server", "lib", "lens-features-extended.js"), "utf8");

  const manifestMatches = manifestSrc.match(/idempotent-lens: \[/g) || [];
  const extendedMatches = extendedSrc.match(/idempotent-lens: \{/g) || [];
  assert.equal(manifestMatches.length, 1, "DOMAIN_TAG_MAP must not gain a duplicate key on re-run");
  assert.equal(extendedMatches.length, 1, "EXTENDED_FEATURES must not gain a duplicate key on re-run");

  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", path.join(root, "server", "lib", "lens-manifest.js")], { stdio: "pipe" }));
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", path.join(root, "server", "lib", "lens-features-extended.js")], { stdio: "pipe" }));
});

test("--dry-run touches no files at all", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const manifestBefore = fs.readFileSync(path.join(root, "server", "lib", "lens-manifest.js"), "utf8");
  const extendedBefore = fs.readFileSync(path.join(root, "server", "lib", "lens-features-extended.js"), "utf8");

  const res = runScaffolder(["dry-run-lens", "Dry Run Lens", "SPECIALIZED", "--root", root, "--dry-run"]);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /\[dry-run\] would write/);

  assert.ok(!fs.existsSync(path.join(root, "server", "domains", "dry-run-lens.js")));
  assert.ok(!fs.existsSync(path.join(root, "concord-frontend", "app", "lenses", "dry-run-lens")));

  const manifestAfter = fs.readFileSync(path.join(root, "server", "lib", "lens-manifest.js"), "utf8");
  const extendedAfter = fs.readFileSync(path.join(root, "server", "lib", "lens-features-extended.js"), "utf8");
  assert.equal(manifestBefore, manifestAfter, "DOMAIN_TAG_MAP file must be byte-identical after --dry-run");
  assert.equal(extendedBefore, extendedAfter, "EXTENDED_FEATURES file must be byte-identical after --dry-run");
});

test("rejects an invalid lens-id and an unknown category before writing anything", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const badId = runScaffolder(["BadID", "Bad Id", "SPECIALIZED", "--root", root]);
  assert.equal(badId.code, 1);
  assert.match(badId.stderr, /kebab-case/);

  const badCategory = runScaffolder(["fine-id", "Fine Id", "NOT_A_REAL_CATEGORY", "--root", root]);
  assert.equal(badCategory.code, 1);
  assert.match(badCategory.stderr, /not one of the known enum values/);

  assert.ok(!fs.existsSync(path.join(root, "server", "domains", "bad-id.js")));
  assert.ok(!fs.existsSync(path.join(root, "server", "domains", "fine-id.js")));
});

test("omitting --archetype reproduces the pre-existing default output byte for byte (regression fixture diff)", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Fixed lens-id/display-name/category so the generated bytes are fully
  // deterministic and comparable against a fixture (server/tests/fixtures/
  // scaffold-lens/default-archetype-{domain.js,page.tsx}.fixture) captured
  // from the scaffolder BEFORE the --archetype option was added. This is a
  // real diff against pre-change output, not an assumption that adding the
  // option left the default path alone.
  const res = runScaffolder(["regression-fixture-lens", "Regression Fixture Lens", "SPECIALIZED", "--root", root]);
  assert.equal(res.code, 0, `scaffolder should exit 0; stderr:\n${res.stderr}`);

  const domainFile = path.join(root, "server", "domains", "regression-fixture-lens.js");
  const pageFile = path.join(root, "concord-frontend", "app", "lenses", "regression-fixture-lens", "page.tsx");

  const expectedDomain = fs.readFileSync(
    path.join(__dirname, "fixtures", "scaffold-lens", "default-archetype-domain.js.fixture"),
    "utf8",
  );
  const expectedPage = fs.readFileSync(
    path.join(__dirname, "fixtures", "scaffold-lens", "default-archetype-page.tsx.fixture"),
    "utf8",
  );

  assert.equal(
    fs.readFileSync(domainFile, "utf8"),
    expectedDomain,
    "domain file for the default (no --archetype) path must be byte-for-byte identical to the pre-change fixture",
  );
  assert.equal(
    fs.readFileSync(pageFile, "utf8"),
    expectedPage,
    "page.tsx for the default (no --archetype) path must be byte-for-byte identical to the pre-change fixture",
  );

  // Explicitly passing the default archetype name must produce the exact
  // same bytes as omitting the flag entirely — proves "echo-counter" truly
  // is what omission resolves to, not a second, similar-but-different path.
  const root2 = makeTempRoot();
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  const res2 = runScaffolder(["regression-fixture-lens", "Regression Fixture Lens", "SPECIALIZED", "--archetype", "echo-counter", "--root", root2]);
  assert.equal(res2.code, 0);
  assert.equal(
    fs.readFileSync(path.join(root2, "server", "domains", "regression-fixture-lens.js"), "utf8"),
    expectedDomain,
    "--archetype echo-counter (explicit) must match the omitted-flag default byte for byte",
  );
  assert.equal(
    fs.readFileSync(path.join(root2, "concord-frontend", "app", "lenses", "regression-fixture-lens", "page.tsx"), "utf8"),
    expectedPage,
    "--archetype echo-counter (explicit) must match the omitted-flag default byte for byte",
  );
});

test("--archetype list-crud produces a genuinely different macro/page shape than the default", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["list-crud-lens", "List Crud Lens", "SPECIALIZED", "--archetype", "list-crud", "--root", root]);
  assert.equal(res.code, 0, `scaffolder should exit 0; stderr:\n${res.stderr}`);

  const domainFile = path.join(root, "server", "domains", "list-crud-lens.js");
  const pageFile = path.join(root, "concord-frontend", "app", "lenses", "list-crud-lens", "page.tsx");
  assert.ok(fs.existsSync(domainFile), "domain file should be written");
  assert.ok(fs.existsSync(pageFile), "page.tsx should be written");

  // Self-check: the generated domain file must be real, syntactically
  // valid JS — not a string-contains assertion.
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", domainFile], { stdio: "pipe" });
  }, "generated list-crud domain file must pass `node --check`");

  const domainSrc = fs.readFileSync(domainFile, "utf8");
  // Genuinely different macro trio from the default echo/counter pair.
  assert.match(domainSrc, /export default function registerListCrudLensMacros\(register\)/);
  assert.match(domainSrc, /register\("list-crud-lens", "create", async/);
  assert.match(domainSrc, /register\("list-crud-lens", "list", async/);
  assert.match(domainSrc, /register\("list-crud-lens", "delete", async/);
  assert.doesNotMatch(domainSrc, /"echo"/, "list-crud archetype must not emit the default echo macro");
  assert.doesNotMatch(domainSrc, /"counter"/, "list-crud archetype must not emit the default counter macro");
  // Same honesty discipline as the default template: real macros, not a
  // TODO placeholder, and an explicit "not durable" disclosure since state
  // is an in-memory Map rather than a real table.
  assert.doesNotMatch(domainSrc, /\/\/\s*TODO\b/i, "generated macro must be real, not a TODO placeholder");
  assert.match(domainSrc, /not durable/i);

  const pageSrc = fs.readFileSync(pageFile, "utf8");
  assert.match(pageSrc, /'use client';/);
  assert.match(pageSrc, /import \{ LensShell \} from '@\/components\/lens\/LensShell';/);
  assert.match(pageSrc, /import \{ ManifestActionBar \} from '@\/components\/lens\/ManifestActionBar';/);
  assert.match(pageSrc, /lensRun<CreateResult>\('list-crud-lens', 'create'/);
  assert.match(pageSrc, /lensRun<ListResult>\('list-crud-lens', 'list'/);
  assert.match(pageSrc, /lensRun<DeleteResult>\('list-crud-lens', 'delete'/);
  assert.match(pageSrc, /<table/, "list-crud page should render a real table, not just buttons");
  assert.doesNotMatch(pageSrc, /<UniversalActions/);
  assert.doesNotMatch(pageSrc, /<LensFeaturePanel/);
  const opens = (pageSrc.match(/\{/g) || []).length;
  const closes = (pageSrc.match(/\}/g) || []).length;
  assert.equal(opens, closes, "page.tsx braces should balance");

  // Registry edits still land and stay valid JS.
  const extendedFile = path.join(root, "server", "lib", "lens-features-extended.js");
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", extendedFile], { stdio: "pipe" }));
  assert.match(fs.readFileSync(extendedFile, "utf8"), /list-crud-lens: \{/);

  // This archetype's output must genuinely differ from the default
  // archetype's output for the same lens-id/displayName/category — proves
  // the flag actually changes behavior, not just cosmetically.
  const rootDefault = makeTempRoot();
  t.after(() => fs.rmSync(rootDefault, { recursive: true, force: true }));
  runScaffolder(["list-crud-lens", "List Crud Lens", "SPECIALIZED", "--root", rootDefault]);
  const defaultDomainSrc = fs.readFileSync(path.join(rootDefault, "server", "domains", "list-crud-lens.js"), "utf8");
  assert.notEqual(domainSrc, defaultDomainSrc, "list-crud archetype output must differ from the default archetype output");
});

test("an unknown --archetype value is rejected before writing anything", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["bad-archetype-lens", "Bad Archetype Lens", "SPECIALIZED", "--archetype", "not-a-real-archetype", "--root", root]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /archetype .* is not one of the known values/);
  assert.ok(!fs.existsSync(path.join(root, "server", "domains", "bad-archetype-lens.js")));
});

test("computed lensNumber is greater than every existing lensNumber in the real registries", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const res = runScaffolder(["numbered-lens", "Numbered Lens", "SPECIALIZED", "--root", root]);
  assert.equal(res.code, 0);
  const match = res.stdout.match(/lensNumber=(\d+)/);
  assert.ok(match, "stdout should report the computed lensNumber");
  const assigned = Number(match[1]);

  const realFeaturesSrc = fs.readFileSync(path.join(REPO_ROOT, "server", "lib", "lens-features.js"), "utf8");
  const realExtendedSrc = fs.readFileSync(REAL_EXTENDED_FEATURES, "utf8");
  let maxExisting = 0;
  for (const src of [realFeaturesSrc, realExtendedSrc]) {
    for (const m of src.matchAll(/lensNumber:\s*(\d+)/g)) {
      maxExisting = Math.max(maxExisting, Number(m[1]));
    }
  }
  assert.ok(assigned > maxExisting, `assigned lensNumber ${assigned} should exceed existing max ${maxExisting}`);
});
