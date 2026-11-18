// server/tests/unity-ci-workflow.test.js
//
// P0-18 — Unity CI lock-in.
//
// .github/workflows/unity-ci.yml is the Concordia Unity client's
// only CI. Its load-bearing properties are not stylistic:
//
//   * every job runs ONLY on the self-hosted `concordia-build`
//     label (the dedicated build machine, P0-30). GitHub-hosted
//     runners cannot hold this project (~14 GB of Assets, packs on
//     the R2 rail), and the workflow must never land on the owner's
//     Mac — hence also: no schedule trigger anywhere.
//   * it triggers only on changes to the Unity client, the asset
//     rail scripts, or itself.
//   * the Unity version it pins agrees with the project's
//     ProjectVersion.txt (drift between the two silently tests the
//     wrong editor).
//   * the §2.4 pipeline order holds: pull assets → EditMode →
//     PlayMode → builds → R2 upload → size report → coverage
//     report, driving the project's own batch entry points.
//   * PlayMode runs WITHOUT -nographics (the proofs render; the
//     build machine provides the GPU) while EditMode runs with it.
//
// This test reads the workflow as text, the same way
// platinum-codeql-drift.test.js pins codeql.yml: no YAML parser
// dependency, and a failure names the property that moved.
// Reference: CONCORDIA_PLAN.md §2.4; apps/concordia-living-world/
// unity-client/CI.md.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const REPO_ROOT = join(HERE, "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "unity-ci.yml");
const PROJECT_VERSION = join(
  REPO_ROOT,
  "apps",
  "concordia-living-world",
  "unity-client",
  "ProjectSettings",
  "ProjectVersion.txt",
);

const yml = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, "utf8") : "";

test("unity-ci.yml exists (P0-18 deliverable)", () => {
  assert.ok(
    existsSync(WORKFLOW),
    ".github/workflows/unity-ci.yml is missing — the Unity client has no CI",
  );
});

test("every job runs only on the self-hosted concordia-build label", () => {
  const runsOn = yml
    .split("\n")
    .filter((line) => /^\s*runs-on:/.test(line));
  assert.ok(runsOn.length >= 1, "no runs-on found in unity-ci.yml");
  for (const line of runsOn) {
    assert.match(line, /self-hosted/, `runs-on lacks self-hosted: ${line}`);
    assert.match(line, /concordia-build/, `runs-on lacks the concordia-build label: ${line}`);
    assert.doesNotMatch(
      line,
      /ubuntu-|windows-|macos-/,
      `runs-on names a GitHub-hosted label: ${line}`,
    );
  }
});

test("no schedule trigger — the workflow can never fire on a timer", () => {
  assert.doesNotMatch(yml, /^\s*schedule:/m);
  assert.doesNotMatch(yml, /^\s*- cron:/m);
});

test("triggers are path-filtered to the Unity client, the asset rail, and the workflow itself", () => {
  const filter = "'apps/concordia-living-world/unity-client/**'";
  const occurrences = yml.split(filter).length - 1;
  assert.ok(
    occurrences >= 2,
    `unity-client path filter appears ${occurrences} times (want push + pull_request)`,
  );
  assert.match(yml, /'scripts\/assets\/\*\*'/);
  assert.match(yml, /'\.github\/workflows\/unity-ci\.yml'/);
});

test("the pinned Unity version agrees with ProjectVersion.txt", () => {
  const pin = yml.match(/UNITY_VERSION:\s*'([0-9.]+[a-z0-9]*)'/);
  assert.ok(pin, "unity-ci.yml does not pin UNITY_VERSION");
  const project = readFileSync(PROJECT_VERSION, "utf8");
  const declared = project.match(/^m_EditorVersion:\s*(\S+)/m);
  assert.ok(declared, "ProjectVersion.txt carries no m_EditorVersion");
  assert.equal(
    pin[1],
    declared[1],
    `workflow pins ${pin[1]} but the project is ${declared[1]}`,
  );
});

test("the §2.4 pipeline order holds and drives the project's own entry points", () => {
  const at = (needle) => {
    const i = yml.indexOf(needle);
    assert.ok(i >= 0, `unity-ci.yml is missing: ${needle}`);
    return i;
  };
  const pull = at("scripts/assets/pull-assets.mjs");
  const editMode = at("-testPlatform EditMode");
  const playMode = at("-testPlatform PlayMode");
  const webgl = at("Concordia.Editor.ConcordiaWebExport.Export");
  const desktop = at("Concordia.Editor.ConcordiaServerExport.BuildLinuxServer");
  const upload = at("builds/webgl/$GITHUB_SHA/");
  const size = at("scripts/assets/budget.mjs");
  const coverage = at("- name: AnimationCoverage report (AN-05)");
  assert.ok(pull < editMode, "assets must be pulled before EditMode tests");
  assert.ok(editMode < playMode, "EditMode runs before PlayMode");
  assert.ok(playMode < webgl && playMode < desktop, "tests run before builds");
  assert.ok(webgl < upload && desktop < upload, "builds complete before the R2 upload");
  assert.ok(upload < size, "the size report follows the upload");
  assert.ok(size < coverage, "the coverage report is the last report step");
  assert.match(yml, /builds\/desktop-linux\/\$GITHUB_SHA\//);
});

test("EditMode runs with -nographics; PlayMode runs without it", () => {
  const steps = yml.split(/^\s*- name:/m).slice(1);
  const byName = (name) => {
    const step = steps.find((s) => s.startsWith(` ${name}`));
    assert.ok(step, `step not found: ${name}`);
    // Only the invocation counts — comments may name the flag to
    // explain its absence.
    return step
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
  };
  assert.match(byName("EditMode tests"), /-nographics/);
  assert.doesNotMatch(byName("PlayMode tests"), /-nographics/);
});

test("least-privilege token scope is declared", () => {
  assert.match(yml, /permissions:\s*\n\s*contents: read/);
});
