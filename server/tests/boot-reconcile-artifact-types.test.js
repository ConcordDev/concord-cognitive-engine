// Boot-level pin for reconcileArtifactTypes (SEC-RECONCILE).
//
// lib/lens-artifact-types.js documents the defect: DOMAIN_RULES
// vocabularies reject the artifact types the lenses actually create
// (Board's "+ Add task" sent board/task; every new goal sent
// goals/goal), so those creates failed with validation_failed.
// reconcileArtifactTypes() merges the frontend vocabulary into the
// registry, and server.js calls it once in the boot path — inside a
// try/catch that only warns on failure:
//
//   try {
//     for (const [k, v] of EXTENDED_DOMAIN_RULES) { ... }
//     reconcileArtifactTypes(DOMAIN_RULES);
//   } catch (_e) { console.warn("[DomainLogic] Failed to merge ..."); }
//
// The unit suite (tests/lens-artifact-types.test.js) pins the merge
// by calling the function itself. Nothing pinned the BOOT: if the
// call were dropped, reordered ahead of the extended-rules merge,
// or threw into that catch, every affected lens create would fail
// in production while the unit tests stayed green. This suite boots
// the real server (temp DATA_DIR, no egress) and asserts — without
// ever calling reconcileArtifactTypes — that after boot:
//
//   1. the registry carries the frontend types (board/task canonical);
//   2. validateArtifact — the exact function the lens create handler
//      runs — accepts them;
//   3. a real lens create of board/task through runMacro succeeds
//      and persists;
//   4. validation still rejects an unknown type (the reconcile must
//      widen the vocabulary, not disable the gate).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-boot-reconcile-"));
process.env.CONCORD_LOW_MEMORY_HOST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { FRONTEND_ARTIFACT_TYPES } from "../lib/lens-artifact-types.js";

const { __TEST__ } = await import("../server.js");
registerServerCleanExit(() => __TEST__);
const { STATE, runMacro, makeInternalCtx } = __TEST__;

describe("boot: reconcileArtifactTypes survives the real boot sequence", () => {
  it("registry carries the reconciled frontend types after boot (board/task canonical)", () => {
    const board = DOMAIN_RULES.get("board");
    assert.ok(board, "board rule must exist after boot");
    assert.ok(board.types.includes("task"), `board types must include "task" after boot, got: ${board.types.join(", ")}`);
    const goals = DOMAIN_RULES.get("goals");
    assert.ok(goals, "goals rule must exist after boot");
    assert.ok(goals.types.includes("goal"), "goals types must include \"goal\" after boot");
    assert.ok(goals.types.includes("challenge"), "goals types must include \"challenge\" after boot");
    // The whole map, not just the canonical cases: wherever a rule
    // exists with a types list, every frontend type must be in it.
    for (const [domain, types] of Object.entries(FRONTEND_ARTIFACT_TYPES)) {
      const rule = DOMAIN_RULES.get(domain);
      if (!rule || !Array.isArray(rule.types)) continue; // reconcile leaves those alone by design
      for (const t of types) {
        assert.ok(rule.types.includes(t), `${domain} types must include "${t}" after boot`);
      }
    }
  });

  it("the create validation path accepts board/task and goals/goal after boot", () => {
    const boardTask = validateArtifact("board", "task", { title: "x" }, {});
    assert.equal(boardTask.ok, true, `board/task must validate after boot: ${boardTask.errors.join("; ")}`);
    const goalsGoal = validateArtifact("goals", "goal", { title: "x" }, {});
    assert.equal(goalsGoal.ok, true, `goals/goal must validate after boot: ${goalsGoal.errors.join("; ")}`);
  });

  it("a real lens create of board/task succeeds after boot and persists", async () => {
    const ctx = makeInternalCtx("boot-reconcile-pin");
    const created = await runMacro("lens", "create",
      { domain: "board", type: "task", title: "Boot pin task", data: { title: "Boot pin task" } }, ctx);
    assert.equal(created?.ok, true, `board/task create must succeed after boot: ${JSON.stringify(created)}`);
    assert.equal(created.artifact?.type, "task");
    assert.ok(STATE.lensArtifacts.has(created.artifact.id), "created artifact must persist in STATE.lensArtifacts");
  });

  it("validation still rejects an unknown type after boot (gate is live, not disabled)", async () => {
    const v = validateArtifact("board", "not-a-real-type", {}, {});
    assert.equal(v.ok, false);
    assert.match(v.errors.join(" "), /Invalid type "not-a-real-type" for domain "board"/);
    const ctx = makeInternalCtx("boot-reconcile-pin");
    const bogus = await runMacro("lens", "create",
      { domain: "board", type: "not-a-real-type", title: "Bogus", data: {} }, ctx);
    assert.equal(bogus?.ok, false);
    assert.equal(bogus.error, "validation_failed");
  });
});
