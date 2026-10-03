// Pins lib/lens-artifact-types.js: every useLensData(domain, type) call in
// concord-frontend must name a type the server's domain rules accept, or the
// lens's create silently fails with validation_failed. Before this, 104 of
// 211 pairs were rejected (Board "+ Add task", every new goal, ...).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { FRONTEND_ARTIFACT_TYPES, reconcileArtifactTypes } from "../lib/lens-artifact-types.js";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../concord-frontend");
const CALL = /useLensData(?:<[^()]*?>)?\(\s*['"]([\w-]+)['"]\s*,\s*['"]([\w-]+)['"]/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
  }
  return out;
}

function frontendPairs() {
  const pairs = new Map();
  for (const sub of ["app", "components", "hooks", "lib"]) {
    const dir = path.join(FRONTEND, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(CALL)) {
        pairs.set(`${m[1]}/${m[2]}`, path.relative(FRONTEND, f));
      }
    }
  }
  return pairs;
}

for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}

describe("lens artifact types", () => {
  // Runs first, before any reconcile in this process (node:test runs a file's tests in order).
  it("without reconciliation, the real lens creates are rejected (the bug this fixes)", () => {
    assert.equal(validateArtifact("board", "task", { title: "x" }, {}).ok, false);
    assert.equal(validateArtifact("goals", "goal", { title: "x" }, {}).ok, false);
    assert.ok(FRONTEND_ARTIFACT_TYPES.board.includes("task"));
  });

  it("accepts every type the frontend creates", { skip: !fs.existsSync(FRONTEND) && "concord-frontend not checked out" }, () => {
    reconcileArtifactTypes(DOMAIN_RULES);
    const pairs = frontendPairs();
    assert.ok(pairs.size > 100, `scan found only ${pairs.size} useLensData calls; the regex or path is wrong`);
    const rejected = [];
    for (const [pair, file] of pairs) {
      const [domain, type] = pair.split("/");
      const r = validateArtifact(domain, type, { title: "x" }, {});
      if (!r.ok) rejected.push(`${pair} (${file})`);
    }
    assert.deepEqual(rejected, [], `add these to lib/lens-artifact-types.js:\n${rejected.join("\n")}`);
  });

  it("still rejects a type nobody sends", () => {
    reconcileArtifactTypes(DOMAIN_RULES);
    assert.equal(validateArtifact("board", "not-a-real-type", {}, {}).ok, false);
    assert.equal(validateArtifact("goals", "ticket", {}, {}).ok, false);
  });

  it("is idempotent", () => {
    reconcileArtifactTypes(DOMAIN_RULES);
    assert.equal(reconcileArtifactTypes(DOMAIN_RULES), 0);
  });
});
