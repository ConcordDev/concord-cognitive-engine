/**
 * #11 — ghost-fleet async-registration race: PINNING test (already correct).
 *
 * The concern: ~36 ghost-fleet macros (hlr.*, quest.*, agents.*, research.*, …)
 * might register asynchronously AFTER the dispatcher could first look them up,
 * so `/api/lens/run` would `unknown_macro` them forever.
 *
 * Verified against the code — SAFE BY DESIGN, not a race:
 *   • `initGhostFleet` is a single `async` function that `await import()`s each
 *     module sequentially and calls `register(...)` SYNCHRONOUSLY right after
 *     each import. No `register(` is deferred behind a setTimeout/setInterval,
 *     so once `initGhostFleet()` RESOLVES every intended macro is in MACROS.
 *   • The invocation runs `validateRegistry(MACROS)` inside
 *     `initGhostFleet().then(...)`, i.e. only AFTER all registrations land — the
 *     steady-state guard can't observe a half-registered map.
 * The only window where a fleet macro is absent is the intentional boot delay
 * (T+20s, `CONCORD_GHOST_FLEET_DELAY_MS`) before the fleet starts loading — the
 * documented trade-off, mitigated by the post-init validator. A macro cannot be
 * registered before its module is imported, so there is nothing to "fix".
 *
 * This locks the two structural invariants that GUARANTEE no async-registration
 * race, so a future refactor that defers a `register(` behind a timer (the exact
 * shape of the old T+225s bug) fails here loudly.
 *
 * Run: node --test tests/ghost-fleet-registration-sync.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(join(__dirname, "..", "server.js"), "utf8");

function ghostFleetBody() {
  const start = SERVER_JS.indexOf("async function initGhostFleet()");
  assert.ok(start > -1, "initGhostFleet must exist and be async");
  const end = SERVER_JS.indexOf("// #11 — ghost-fleet registration race", start);
  assert.ok(end > start, "initGhostFleet body delimiter must be found");
  return SERVER_JS.slice(start, end);
}

test("initGhostFleet registers a substantial set of bus macros", () => {
  const body = ghostFleetBody();
  const pairs = [...body.matchAll(/register\(\s*["']([\w.\-]+)["']\s*,\s*["']([\w.\-]+)["']/g)]
    .map((m) => `${m[1]}.${m[2]}`);
  const unique = new Set(pairs);
  // The #11 finding cited "~36 macros"; the real fleet is far larger. Pin a
  // conservative floor so an accidental gutting of the fleet is caught.
  assert.ok(unique.size >= 36, `expected >= 36 ghost-fleet macros, got ${unique.size}`);
});

test("no ghost-fleet register() is deferred behind a setTimeout/setInterval", () => {
  const body = ghostFleetBody();
  // For each timer call, walk its argument by paren depth; a register( that
  // occurs while inside the timer's argument would only run AFTER init resolves
  // — the async-registration race. There must be zero.
  const timerOpens = [...body.matchAll(/set(?:Timeout|Interval)\(/g)].map((m) => m.index + m[0].length - 1);
  let nested = 0;
  for (const open of timerOpens) {
    let depth = 0;
    for (let i = open; i < body.length; i++) {
      const c = body[i];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) break; }
      if (depth > 0 && body.startsWith("register(", i)) nested++;
    }
  }
  assert.equal(nested, 0, "every register() must run synchronously with its module load, never deferred in a timer");
});

test("validateRegistry(MACROS) runs only AFTER initGhostFleet resolves", () => {
  // The invocation must await the fleet before validating the registry.
  const invoke = SERVER_JS.slice(SERVER_JS.indexOf("// #11 — ghost-fleet registration race"));
  const thenIdx = invoke.indexOf("initGhostFleet()");
  assert.ok(thenIdx > -1, "initGhostFleet() must be invoked");
  const chain = invoke.slice(thenIdx, thenIdx + 1500);
  assert.match(chain, /initGhostFleet\(\)\s*\.then\(/, "fleet must be awaited via .then(...) before validation");
  assert.match(chain, /validateRegistry\(\s*MACROS\s*\)/, "validateRegistry(MACROS) must run in the post-init .then()");
});
