// server/tests/inference-syllogism-barbara.test.js
//
// FIX-inference-002: the syllogism engine refused the canonical Barbara
// chain when the premises were entered in chain order — major
// 'All A are B', minor 'All B are C' — with
// 'Category mismatch: "c" does not match "a"', because the universal-minor
// branch only tried the subclass orientation (minor's object vs the
// major's subject) and never the chain orientation (minor's subject vs
// the major's object). Both slot orders are the same syllogism; the
// engine now derives 'All A are C' for the chain order while the
// subclass order and the singular path keep their exact prior behavior,
// and genuinely unchainable premises still refuse by name.
//
// Boots the real server (temp DATA_DIR, no egress) and drives the real
// inference.syllogism macro — the same dispatch the lens panel calls.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-syllogism-barbara-"));
process.env.CONCORD_LOW_MEMORY_HOST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

const { __TEST__ } = await import("../server.js");
registerServerCleanExit(() => __TEST__);
const { runMacro, makeInternalCtx } = __TEST__;

const syllogism = (majorPremise, minorPremise) =>
  runMacro("inference", "syllogism", { majorPremise, minorPremise }, makeInternalCtx("syllogism-barbara-pin"));

describe("inference syllogism — Barbara in both slot orders (FIX-inference-002)", () => {
  it("chain order: 'All A are B' + 'All B are C' derives 'All A are C'", async () => {
    const r = await syllogism("All A are B", "All B are C");
    assert.equal(r?.ok, true, `chain Barbara must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.conclusion, "All a are c");
    assert.equal(r.derivation?.conclusion, "all a are c");
    assert.deepEqual(r.kbWrites?.premisesStored, ["all a are b", "all b are c"]);
  });

  it("chain order with real words and plurals: mammals chain", async () => {
    const r = await syllogism("All mammals are animals", "All animals are mortal");
    assert.equal(r?.ok, true, `chain with words must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.conclusion, "All mammals are mortal");
  });

  it("subclass order unchanged: 'All mammals are mortal' + 'All whales are mammals'", async () => {
    const r = await syllogism("All mammals are mortal", "All whales are mammals");
    assert.equal(r?.ok, true, `subclass Barbara must still succeed: ${JSON.stringify(r)}`);
    assert.equal(r.conclusion, "All whales are mortal");
    assert.deepEqual(r.kbWrites?.premisesStored, ["all mammal are mortal", "all whale are mammal"]);
  });

  it("singular path unchanged: 'All mammals are warm-blooded' + 'A whale is a mammal'", async () => {
    const r = await syllogism("All mammals are warm-blooded", "A whale is a mammal");
    assert.equal(r?.ok, true, `singular Barbara must still succeed: ${JSON.stringify(r)}`);
  });

  it("unchainable universals still refuse with the category-mismatch error", async () => {
    const r = await syllogism("All A are B", "All X are Y");
    assert.equal(r?.ok, false, `unchainable pair must refuse: ${JSON.stringify(r)}`);
    assert.equal(r.step, "category");
    assert.match(r.error, /Category mismatch/);
  });
});
