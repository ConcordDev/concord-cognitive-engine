// Invariant: any npm script that launches node with a `--max-old-space-size`
// ceiling must be internally self-consistent with the two runtime signals
// that ceiling feeds:
//
//   (a) `--expose-gc` must also be passed. Both memory watchdogs' trim
//       paths end in `if (global.gc) global.gc()` (server/server.js's
//       inline "Memory Ceiling Monitor" ~line 60207, and
//       server/lib/memory-pressure.js#_tryGC). Without the flag, `global.gc`
//       is undefined and the one concrete corrective action either watchdog
//       can take silently no-ops.
//
//   (b) `MAX_OLD_SPACE_SIZE` must be set in the env for the SAME script, to
//       the SAME numeric value as `--max-old-space-size`. Both
//       server/lib/memory-pressure.js (`HEAP_LIMIT_MB`) and
//       server/routes/system.js (`heapLimitMB`) read
//       `process.env.MAX_OLD_SPACE_SIZE` (falling back to a hardcoded 32768
//       default) to compute heap-pressure percentage — that env var is
//       otherwise never set by node itself from the CLI flag. If the two
//       numbers drift, the watchdog computes pressure against the wrong
//       baseline and may never fire even when genuinely near the real
//       ceiling.
//
// ecosystem.config.cjs (the real bare-metal pm2 deploy) already keeps both
// of these in sync deliberately (see its own inline comments) — this test
// pins the same discipline for server/package.json's start/dev scripts.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "../../package.json");

function loadScripts() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.scripts || {};
}

/**
 * Extract the numeric arg of `--max-old-space-size=N` from a script's node
 * invocation, and the numeric value of a `MAX_OLD_SPACE_SIZE=N` env-var
 * assignment prefixed onto the same script line (the convention this
 * codebase already uses for `NODE_ENV=test` / `DB_PATH=...` — see
 * test:main / test:depth:raw in this same package.json).
 */
function parseScript(cmd) {
  const heapFlagMatch = cmd.match(/--max-old-space-size=(\d+)/);
  const envMatch = cmd.match(/(?:^|\s)MAX_OLD_SPACE_SIZE=(\d+)(?:\s|$)/);
  const hasExposeGc = /--expose-gc\b/.test(cmd);
  return {
    heapFlagValue: heapFlagMatch ? Number(heapFlagMatch[1]) : null,
    envValue: envMatch ? Number(envMatch[1]) : null,
    hasExposeGc,
  };
}

test("every script passing --max-old-space-size also passes --expose-gc", () => {
  const scripts = loadScripts();
  const offenders = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    const { heapFlagValue, hasExposeGc } = parseScript(cmd);
    if (heapFlagValue !== null && !hasExposeGc) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `scripts missing --expose-gc despite setting --max-old-space-size: ${offenders.join(", ")}`);
});

test("every script passing --max-old-space-size also sets MAX_OLD_SPACE_SIZE in env, numerically identical", () => {
  const scripts = loadScripts();
  const offenders = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    const { heapFlagValue, envValue } = parseScript(cmd);
    if (heapFlagValue === null) continue;
    if (envValue === null) {
      offenders.push(`${name}: MAX_OLD_SPACE_SIZE not set in script env (flag=${heapFlagValue})`);
    } else if (envValue !== heapFlagValue) {
      offenders.push(`${name}: MAX_OLD_SPACE_SIZE=${envValue} != --max-old-space-size=${heapFlagValue}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "));
});

test("start and dev scripts specifically are wired (regression pin for the durability-audit fix)", () => {
  const scripts = loadScripts();
  for (const name of ["start", "dev"]) {
    const cmd = scripts[name];
    assert.ok(cmd, `expected a "${name}" script`);
    const { heapFlagValue, envValue, hasExposeGc } = parseScript(cmd);
    assert.equal(heapFlagValue, 32768, `${name}: expected --max-old-space-size=32768`);
    assert.equal(envValue, 32768, `${name}: expected MAX_OLD_SPACE_SIZE=32768 in env`);
    assert.ok(hasExposeGc, `${name}: expected --expose-gc`);
  }
});

// ── Mutation-verification (proves the checker above is not a rubber stamp) ──
// These don't touch the real package.json; they exercise the same
// parseScript()/assertion logic against deliberately-broken strings to prove
// each failure mode is actually caught.

test("mutation check: catches a script missing --expose-gc", () => {
  const cmd = "MAX_OLD_SPACE_SIZE=32768 node --max-old-space-size=32768 server.js";
  const { heapFlagValue, hasExposeGc } = parseScript(cmd);
  assert.equal(heapFlagValue, 32768);
  assert.equal(hasExposeGc, false, "expected the mutated script to be missing --expose-gc");
});

test("mutation check: catches a desynced MAX_OLD_SPACE_SIZE vs --max-old-space-size", () => {
  const cmd = "MAX_OLD_SPACE_SIZE=16384 node --max-old-space-size=32768 --expose-gc server.js";
  const { heapFlagValue, envValue } = parseScript(cmd);
  assert.equal(heapFlagValue, 32768);
  assert.equal(envValue, 16384);
  assert.notEqual(envValue, heapFlagValue, "expected the mutated script's env/flag values to disagree");
});

test("mutation check: catches MAX_OLD_SPACE_SIZE entirely unset", () => {
  const cmd = "node --max-old-space-size=32768 --expose-gc server.js";
  const { heapFlagValue, envValue } = parseScript(cmd);
  assert.equal(heapFlagValue, 32768);
  assert.equal(envValue, null, "expected the mutated script to have no MAX_OLD_SPACE_SIZE env value");
});
