#!/usr/bin/env node
// scripts/depth-scaffold.mjs <domain>
//
// The boilerplate killer. Enumerates a lens-action domain's actions, boots the
// server once, PROBES each action's real I/O through the lensRun flow, and emits
// a skeleton server/tests/depth/<domain>-behavior.test.js with:
//   • a literal `lensRun("<domain>","<action>", …)` call per action (the form the
//     grader credits as behavioral), and
//   • the captured output pasted as a `// PROBE:` comment (your guide to the real
//     value), and
//   • a `// @depth-todo` marker + a `throw` so the test CANNOT be left shape-only
//     or committed incomplete — you replace the throw with a REAL assertion.
//
// This removes the ~25 min of enumerate+probe+boilerplate; you author only the
// assertion (~5 min/domain). The guard (scripts/check-depth-tests.mjs) then makes
// sure every scaffolded test gets a real assertion before it can merge.
//
//   node scripts/depth-scaffold.mjs accounting          # writes the skeleton
//   node scripts/depth-scaffold.mjs accounting --force   # overwrite existing
//
// IMPORTANT: a freshly-scaffolded file FAILS (the throws) and must NOT be graded
// as-is — run `npm run depth:check` before `npm run grade-macros:honest`.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const domain = process.argv[2];
const FORCE = process.argv.includes("--force");
if (!domain || domain.startsWith("--")) {
  console.error("usage: node scripts/depth-scaffold.mjs <domain> [--force]");
  process.exit(1);
}

const domainFile = path.join(ROOT, "server", "domains", `${domain}.js`);
if (!existsSync(domainFile)) {
  console.error(`No server/domains/${domain}.js — is "${domain}" a lens-action domain? (see npm run depth:backlog)`);
  process.exit(1);
}

// Enumerate this domain's actions (registerLensAction("<domain>","<action>", …)).
const src = readFileSync(domainFile, "utf8");
const esc = domain.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
const re = new RegExp(`registerLensAction\\(\\s*["'\`]${esc}["'\`]\\s*,\\s*["'\`]([a-zA-Z0-9_.-]+)["'\`]`, "g");
const actions = [...new Set([...src.matchAll(re)].map((m) => m[1]))];
if (actions.length === 0) {
  console.error(`Found 0 registerLensAction("${domain}", …) in ${domain}.js — not a lens-action domain.`);
  process.exit(1);
}

const outPath = path.join(ROOT, "server", "tests", "depth", `${domain}-behavior.test.js`);
if (existsSync(outPath) && !FORCE) {
  console.error(`${path.relative(ROOT, outPath)} already exists — pass --force to overwrite (you'll lose hand-written assertions!).`);
  process.exit(1);
}

console.error(`Booting server + probing ${actions.length} ${domain} actions…`);
const { lensRun, depthCtx } = await import("../server/tests/depth/_harness.js");
const ctx = await depthCtx(`scaffold:${domain}`);

const trunc = (o) => { try { return JSON.stringify(o).slice(0, 200); } catch { return String(o); } };
const blocks = [];
for (const action of actions) {
  let probe;
  try {
    const r = await lensRun(domain, action, { data: {}, params: {} }, ctx);
    probe = trunc(r && (r.result ?? r));
  } catch (e) { probe = `THREW: ${e?.message || e}`; }
  blocks.push(
`  // @depth-todo — replace the throw with a REAL assertion (exact value / round-trip / rejection).
  // PROBE (empty input): ${probe}
  it(${JSON.stringify(`${action}: <describe the behavior>`)}, async () => {
    const r = await lensRun(${JSON.stringify(domain)}, ${JSON.stringify(action)}, { data: {}, params: {} }, ctx);
    throw new Error("@depth-todo: assert ${domain}.${action} — give real inputs above + a real assertion below");
    // assert.equal(r.ok, true);
    // assert.equal(r.result.SOMEFIELD, EXPECTED);   // calc: exact computed value
    // assert.ok((r.result.items || []).some(x => x.id === created.id)); // CRUD: round-trip
  });`);
}

const file = `// tests/depth/${domain}-behavior.test.js
// SCAFFOLDED by scripts/depth-scaffold.mjs — ${actions.length} actions. Each it() has a
// literal lensRun (grader-credited) but a @depth-todo throw: replace each with a
// REAL behavioral assertion (see the // PROBE comment for the live shape), then
// run \`npm run depth:check\`. Do NOT leave shape-only \`assert.ok(r.ok)\` tests.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe(${JSON.stringify(`${domain} — behavioral (scaffolded; complete the @depth-todo assertions)`)}, () => {
  let ctx;
  before(async () => { ctx = await depthCtx(${JSON.stringify(`${domain}-depth`)}); });

${blocks.join("\n\n")}
});
`;

writeFileSync(outPath, file);
console.error(`\nWrote ${path.relative(ROOT, outPath)} — ${actions.length} @depth-todo tests.`);
console.error(`Next: fill in the assertions (use the // PROBE comments), then \`npm run depth:check\`.`);
process.exit(0);
