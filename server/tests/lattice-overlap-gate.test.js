/**
 * Birth-overlap gate.
 *
 * The old step compared genesis invariants to Object.keys(STATE.settings)
 * and scaled the bar with raw DTU count, so every governed call past 1,000
 * DTUs died with overlap_below_threshold (score stuck at 0.3, and the stored
 * thresholdOverlap of 0.95 was ignored because the ladder only honored a
 * manual value strictly below 0.95).
 *
 * These tests boot the real gate. One missed anchor invariant out of five
 * scores 0.7 * (4/5) + 0.3 = 0.86, which is above the old 5,000-DTU ladder
 * bar (0.50) and below the real default (0.95).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

const serverSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"),
  "utf8",
);

let __TEST__;
before(async () => {
  const mod = await import("../server.js");
  __TEST__ = mod.__TEST__;
  if (!__TEST__) throw new Error("server.js did not export __TEST__");
  delete process.env.CONCORD_OVERLAP_THRESHOLD;
  assert.equal(__TEST__.STATE.__chicken2.thresholdOverlap, 0.95);
  padDtus(5000);
  assert.ok(__TEST__.STATE.dtus.size >= 5000, `expected >= 5000 DTUs, saw ${__TEST__.STATE.dtus.size}`);
});
registerServerCleanExit(() => __TEST__);

const GENESIS_INVARIANTS = [
  "x^2 - x = 0",
  "x^2 - x - 1 = 0",
  "NO_NEGATIVE_VALENCE_DIMENSION",
  "REPAIR_DOMINANCE_REQUIRED",
  "OVERLAP>=0.95",
];

function genesis() {
  const g = __TEST__.STATE.dtus.get("genesis_reality_anchor_v1");
  assert.ok(g, "genesis anchor is seeded");
  return g;
}

function padDtus(target) {
  const store = __TEST__.STATE.dtus;
  if (store.size >= target) return store.size;
  const db = __TEST__.db;
  assert.ok(db, "test server exposes db");
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO dtu_store (id, title, tier, scope, tags, source, created_at, updated_at, data)
     VALUES (?, 'overlap-pad', 'regular', 'local', '[]', 'test', ?, ?, '{}')`,
  );
  const need = target - store.size;
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.transaction(() => {
    for (let i = 0; i < need; i++) insert.run(`overlap_pad_${stamp}_${i}`, now, now);
  })();
  assert.ok(store.size >= target, `pad to ${target} left size at ${store.size}`);
  return store.size;
}

function ctx() {
  return __TEST__.makeInternalCtx("lattice-overlap-gate");
}

async function withChickenThreshold(value, fn) {
  const prev = __TEST__.STATE.__chicken2.thresholdOverlap;
  const prevEnv = process.env.CONCORD_OVERLAP_THRESHOLD;
  delete process.env.CONCORD_OVERLAP_THRESHOLD;
  __TEST__.STATE.__chicken2.thresholdOverlap = value;
  try {
    return await fn();
  } finally {
    __TEST__.STATE.__chicken2.thresholdOverlap = prev;
    if (prevEnv === undefined) delete process.env.CONCORD_OVERLAP_THRESHOLD;
    else process.env.CONCORD_OVERLAP_THRESHOLD = prevEnv;
  }
}

// node:test may start `it` callbacks in parallel. The gate tests share
// STATE.__chicken2 and the process env, so they take one lock.
let _lock = Promise.resolve();
function locked(name, fn) {
  it(name, async () => {
    const wait = _lock;
    let release;
    _lock = new Promise((resolve) => { release = resolve; });
    await wait;
    try {
      await fn();
    } finally {
      release();
    }
  });
}

const BENIGN = {
  title: "Launch checklist",
  text: "Capture the open questions from the review",
};

// One anchor invariant broken. Keyword scan does not see a spaced phrase,
// so the rejection has to come from the overlap comparison itself.
const MISSING_REPAIR = {
  title: "partial anchor",
  repairDominance: false,
  invariants: GENESIS_INVARIANTS.filter(k => k !== "REPAIR_DOMINANCE_REQUIRED"),
  lineage: { root: "genesis_reality_anchor_v1" },
};

const NEGATIVE_VALENCE = {
  title: "open a valence dimension",
  negativeValence: true,
  invariants: GENESIS_INVARIANTS.map(k => k === "NO_NEGATIVE_VALENCE_DIMENSION" ? "NEGATIVE_VALENCE_DIMENSION" : k),
  lineage: { root: "genesis_reality_anchor_v1" },
};

describe("lattice overlap gate", () => {
  locked("does not compare candidates to runtime settings keys", () => {
    assert.doesNotMatch(serverSrc, /Object\.keys\(\s*STATE\.settings/);
    const govStart = serverSrc.indexOf("async function governedCall");
    const govEnd = serverSrc.indexOf("// ===== END CHICKEN2 CORE =====", govStart);
    const gov = serverSrc.slice(govStart, govEnd);
    assert.match(gov, /name:effectName, ctx, input/);
    assert.doesNotMatch(gov, /input:\s*\{\s*\}/);
    assert.match(
      serverSrc,
      /inLatticeReality\(\{ type:"birth", domain:"lattice", name:"birth_protocol", input:proposal, ctx \}\)/,
    );
    for (const effect of ["multimodal.vision_analyze", "multimodal.image_generate", "tools.web_search"]) {
      assert.match(serverSrc, new RegExp(`governedCall\\(ctx, "${effect}"[\\s\\S]*?\\}, input\\)`));
    }
  });

  locked("keeps the threshold fixed across DTU-count buckets and honors 0.95", () => {
    const buckets = [100, 500, 1000, 5000, 10000, 50000];
    const start = __TEST__.STATE.dtus.size;
    const seen = [__TEST__._getOverlapThreshold()];
    let cursor = start;
    for (const boundary of buckets) {
      if (boundary <= cursor) continue;
      // Cross the old ladder boundary. Cap a single jump so a huge boot
      // corpus does not insert hundreds of thousands of rows.
      const target = Math.min(boundary, cursor + 20000);
      if (target <= cursor) continue;
      padDtus(target);
      cursor = __TEST__.STATE.dtus.size;
      seen.push(__TEST__._getOverlapThreshold());
      if (cursor >= 5000 && seen.length >= 3) break;
    }
    if (cursor < start + 1000) {
      padDtus(cursor + 1000);
      seen.push(__TEST__._getOverlapThreshold());
    }
    assert.ok(__TEST__.STATE.dtus.size >= 5000);
    assert.ok(__TEST__.STATE.dtus.size > start, "DTU count must actually change");
    for (const t of seen) assert.equal(t, 0.95);
  });

  locked("honors an explicit thresholdOverlap, including the previously ignored 0.95", async () => {
    const g = genesis();
    assert.deepEqual(g.invariants, GENESIS_INVARIANTS);

    const rejected = await withChickenThreshold(0.95, () => __TEST__.inLatticeReality({
      type: "governedCall",
      domain: "governed",
      name: "notes.capture",
      input: MISSING_REPAIR,
      ctx: ctx(),
    }));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "overlap_below_threshold");
    assert.equal(rejected.meta.threshold, 0.95);
    const oneMiss = 0.7 * (4 / 5) + 0.3;
    assert.ok(Math.abs(rejected.meta.ov - oneMiss) < 1e-9, `ov ${rejected.meta.ov} !== ${oneMiss}`);
    assert.ok(rejected.meta.ov > 0.5, "score stays above the old 5,000-DTU ladder bar");
    assert.ok(rejected.meta.violated.includes("REPAIR_DOMINANCE_REQUIRED"));

    const accepted = await withChickenThreshold(0.5, () => __TEST__.inLatticeReality({
      type: "governedCall",
      domain: "governed",
      name: "notes.capture",
      input: MISSING_REPAIR,
      ctx: ctx(),
    }));
    assert.equal(accepted.ok, true, "explicit 0.5 must admit a score the 0.95 bar rejects");
    assert.equal(__TEST__._getOverlapThreshold(), 0.95);
  });

  locked("honors CONCORD_OVERLAP_THRESHOLD over the stored 0.95, and settings.thresholdOverlap when chicken2 is unset", async () => {
    const prev = __TEST__.STATE.__chicken2.thresholdOverlap;
    const prevSettings = __TEST__.STATE.settings.thresholdOverlap;
    const prevEnv = process.env.CONCORD_OVERLAP_THRESHOLD;
    try {
      __TEST__.STATE.__chicken2.thresholdOverlap = 0.95;
      process.env.CONCORD_OVERLAP_THRESHOLD = "0.5";
      assert.equal(__TEST__._getOverlapThreshold(), 0.5);
      const viaEnv = __TEST__.inLatticeReality({
        type: "governedCall", domain: "governed", name: "notes.capture",
        input: MISSING_REPAIR, ctx: ctx(),
      });
      assert.equal(viaEnv.ok, true);
      assert.ok(__TEST__.STATE.dtus.size >= 5000);

      delete process.env.CONCORD_OVERLAP_THRESHOLD;
      process.env.CONCORD_OVERLAP_THRESHOLD = "nope";
      assert.equal(__TEST__._getOverlapThreshold(), 0.95);

      delete process.env.CONCORD_OVERLAP_THRESHOLD;
      __TEST__.STATE.__chicken2.thresholdOverlap = undefined;
      __TEST__.STATE.settings.thresholdOverlap = 0.42;
      assert.equal(__TEST__._getOverlapThreshold(), 0.42);
    } finally {
      __TEST__.STATE.__chicken2.thresholdOverlap = prev;
      if (prevSettings === undefined) delete __TEST__.STATE.settings.thresholdOverlap;
      else __TEST__.STATE.settings.thresholdOverlap = prevSettings;
      if (prevEnv === undefined) delete process.env.CONCORD_OVERLAP_THRESHOLD;
      else process.env.CONCORD_OVERLAP_THRESHOLD = prevEnv;
    }
  });

  locked("admits a benign governed effect on a 5,000+ DTU substrate at the default bar", async () => {
    assert.ok(__TEST__.STATE.dtus.size >= 5000);
    assert.equal(__TEST__._getOverlapThreshold(), 0.95);
    const result = await __TEST__.governedCall(ctx(), "notes.capture", async () => ({ ran: true }), BENIGN);
    assert.deepEqual(result, { ran: true });
  });

  locked("rejects a payload that drops repair dominance", async () => {
    await assert.rejects(
      () => __TEST__.governedCall(ctx(), "notes.capture", async () => ({ ran: true }), MISSING_REPAIR),
      /governedCall rejected: overlap_below_threshold/,
    );
  });

  locked("rejects a payload that opens a negative valence dimension", async () => {
    const pre = __TEST__.inLatticeReality({
      type: "governedCall",
      domain: "governed",
      name: "notes.capture",
      input: NEGATIVE_VALENCE,
      ctx: ctx(),
    });
    assert.equal(pre.ok, false);
    assert.equal(pre.reason, "overlap_below_threshold");
    assert.ok(pre.meta.violated.includes("NO_NEGATIVE_VALENCE_DIMENSION"));
    await assert.rejects(
      () => __TEST__.governedCall(ctx(), "notes.capture", async () => ({ ran: true }), NEGATIVE_VALENCE),
      /overlap_below_threshold/,
    );
  });

  locked("does not block observe tools on birth-overlap, and still applies valence governance", async () => {
    for (const name of ["tools.web_search", "browse_url", "dtu_search", "dtu.search", "run_compute", "compute"]) {
      const result = await __TEST__.governedCall(
        ctx(),
        name,
        async () => ({ ran: true, name }),
        { ...MISSING_REPAIR, query: "lisbon weather forecast" },
      );
      assert.equal(result.ran, true, `${name} should not be rejected for overlap`);
    }

    // A payload field must not relabel an effectful action as an observe tool.
    await assert.rejects(
      () => __TEST__.governedCall(
        ctx(),
        "ledger.post",
        async () => ({ ran: true }),
        { ...MISSING_REPAIR, tool: "web_search" },
      ),
      /overlap_below_threshold/,
    );

    await assert.rejects(
      () => __TEST__.governedCall(
        ctx(),
        "tools.web_search",
        async () => ({ ran: true }),
        { query: "how to torture a sample" },
      ),
      /negative_valence_projection/,
    );
  });

  locked("birth_protocol still admits its own proposal and rejects one that breaks an anchor invariant", async () => {
    const ok = await __TEST__.runMacro("lattice", "birth_protocol", {
      proposal: {
        title: "Quiet pattern",
        kind: "pattern",
        invariants: ["local-habit"],
        notes: "a small pattern inside the anchor",
      },
      steps: 5,
    }, ctx());
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.dtu.title, "Quiet pattern");
    assert.equal(ok.dtu.lineage.root, "genesis_reality_anchor_v1");
    assert.deepEqual(ok.dtu.invariants, ["local-habit"]);

    const bad = await __TEST__.runMacro("lattice", "birth_protocol", {
      proposal: {
        title: "Broken anchor",
        kind: "pattern",
        ...MISSING_REPAIR,
      },
      steps: 5,
    }, ctx());
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "overlap_below_threshold");
  });

  locked("beacon overlap is the anchor against itself, not a constant from settings keys", async () => {
    const beacon = await __TEST__.runMacro("lattice", "beacon", {}, ctx());
    assert.equal(beacon.ok, true);
    assert.ok(beacon.overlap > 0.95, `beacon overlap ${beacon.overlap}`);
    assert.equal(beacon.awake, true);
    assert.equal(beacon.threshold, 0.95);
  });
});
