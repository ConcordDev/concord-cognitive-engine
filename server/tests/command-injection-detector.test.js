// tests/command-injection-detector.test.js
//
// Proves the command-injection detector actually FIRES on the real bug class it
// was seeded from — PR #808's `execSync(`git diff … ${baseRef}…`)` — and, just
// as important, that it does NOT fire on the things that look similar but are
// safe: `db.exec(`…SQL…`)`, `execFileSync('git', [args])`, string-literal
// commands, and sinks living in comments. A detector that can't tell these
// apart is noise; a detector that misses the real sink is theatre.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runCommandInjectionDetector,
  parseChildProcessBindings,
  classifyCommandArg,
  stripComments,
} from "../lib/detectors/command-injection-detector.js";

async function tmpRepo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cmdinj-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return dir;
}
const sev = (r, id) => r.findings.filter((f) => f.id === id);

describe("command-injection detector — pure helpers", () => {
  it("parses child_process bindings (esm named, ns, cjs) and ignores non-importers", () => {
    assert.deepEqual([...parseChildProcessBindings(`import { execSync, exec } from "node:child_process";`).named].sort(), ["exec", "execSync"]);
    assert.deepEqual([...parseChildProcessBindings(`import cp from 'child_process'`).namespaces], ["cp"]);
    assert.deepEqual([...parseChildProcessBindings(`const { spawn } = require("child_process")`).named], ["spawn"]);
    assert.equal(parseChildProcessBindings(`import Database from "better-sqlite3";`), null);
  });

  it("classifies command args: interpolation/concat flag, literal is safe, taint escalates", () => {
    assert.equal(classifyCommandArg("`git diff ${baseRef}`").flag, true);
    assert.equal(classifyCommandArg("`git diff ${process.env.GITHUB_BASE_REF}`").tainted, true);
    assert.equal(classifyCommandArg("'rm ' + userPath").flag, true);
    assert.equal(classifyCommandArg("`ls -la /tmp`").flag, false, "no interpolation → safe");
    assert.equal(classifyCommandArg("'echo hello'").flag, false);
  });

  it("stripComments removes sinks living in comments but preserves line numbers", () => {
    const src = "a\n// execSync(`bad ${x}`)\n/* execSync(`also ${y}`) */\nb";
    const out = stripComments(src);
    assert.ok(!out.includes("execSync"), "comment sink removed");
    assert.equal(out.split("\n").length, src.split("\n").length, "line count preserved");
  });
});

describe("command-injection detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FIRES (critical) on the PR #808 shape: execSync with argv/env-interpolated command", async () => {
    dir = await tmpRepo({
      "scripts/diff.mjs": [
        `import { execSync } from 'node:child_process';`,
        `const baseRef = process.argv[2] || process.env.GITHUB_BASE_REF;`,
        "const out = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: 'utf8' });",
      ].join("\n"),
    });
    const r = await runCommandInjectionDetector({ root: dir });
    assert.equal(r.ok, true);
    const crit = r.findings.filter((f) => f.severity === "critical");
    assert.ok(crit.length >= 1, "the #808 execSync sink must be flagged critical");
    assert.match(crit[0].location, /diff\.mjs/);
  });

  it("does NOT flag db.exec SQL, execFileSync(args), or a string-literal command", async () => {
    dir = await tmpRepo({
      "lib/safe.js": [
        `import { execFileSync } from 'node:child_process';`,
        `import Database from 'better-sqlite3';`,
        `const db = new Database(':memory:');`,
        "db.exec(`CREATE TABLE t (id TEXT); INSERT INTO t VALUES ('${'x'}')`);", // SQL — not CP
        `execFileSync('git', ['diff', userRef]);`,                              // args array — no shell
        `execFileSync('ls', ['-la']);`,
      ].join("\n"),
    });
    const r = await runCommandInjectionDetector({ root: dir });
    const real = r.findings.filter((f) => f.severity !== "info");
    assert.equal(real.length, 0, `safe patterns must not be flagged, got: ${JSON.stringify(real.map((f) => f.id))}`);
  });

  it("flags spawn ONLY when shell:true re-introduces the shell", async () => {
    dir = await tmpRepo({
      "a.js": [
        `import { spawn } from 'child_process';`,
        "spawn(`evil ${x}`, { shell: true });",   // shell → flagged
      ].join("\n"),
      "b.js": [
        `import { spawn } from 'child_process';`,
        "spawn(cmd, args);",                        // no shell → safe
      ].join("\n"),
    });
    const r = await runCommandInjectionDetector({ root: dir });
    const flagged = r.findings.filter((f) => f.severity !== "info");
    assert.equal(flagged.length, 1, "only the shell:true spawn is a sink");
    assert.match(flagged[0].location, /a\.js/);
  });

  it("never throws — returns ok:true on an empty tree", async () => {
    dir = await tmpRepo({ "x.txt": "no code here" });
    const r = await runCommandInjectionDetector({ root: dir });
    assert.equal(r.ok, true);
  });
});
