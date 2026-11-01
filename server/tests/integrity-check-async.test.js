// The periodic integrity check ran synchronously on the main thread (8-12 s; its first staggered fire lands
// ~60-75 s after every boot and the block ended within ~5 ms of the periodic_integrity_check log line).
// runIntegrityCheckAsync runs the SAME audits/fixes time-sliced. Pins: identical results and STATE mutations,
// real yielding, and server.js wiring (periodic + admin route use it; attributed via loopJobs).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIntegrityCheck, runIntegrityCheckAsync } from "../lib/integrity-check.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOMS = ["math", "physics", "code", "bio"]; // must be in LENS_DOMAIN_KEYWORDS_KEYS; checked below

function mkState(n = 400) {
  const dtus = new Map(); const lens = new Map();
  for (let i = 0; i < n; i++) {
    const parents = i > 4 ? ["d" + (i - 2), i % 7 === 0 ? "ghost" + i : "d" + (i - 4)] : [];
    dtus.set("d" + i, { id: "d" + i, tags: [DOMS[i % 4], "t" + (i % 5)], lineage: { parents }, parentId: i % 11 === 0 && i > 0 ? "ghostP" + i : null, tier: "regular", title: "T" + i });
    if (i % 3) lens.set(`dtu_lens_${DOMS[i % 4]}_d${i}`, { id: i });
  }
  const citedBy = new Map([["d1", new Set(["d2", "nope1"])], ["goneCited", new Set(["d3", "d4"])], ["d5", new Set(["d6"])]]);
  const follows = new Map([["u1", new Set(["u2", "ghostU"])], ["u2", new Set(["u1"])]]);
  const followers = new Map([["u2", new Set(["u1", "u9"])], ["u1", new Set(["u2"])]]);
  const profiles = new Map([["u1", {}], ["u2", {}], ["u9", {}]]);
  return {
    dtus, lensArtifacts: lens, lensDomainIndex: new Map(),
    wallets: new Map([["w1", { balance: -5 }], ["w2", { balance: 10 }]]),
    economic: { wallets: new Map([["e1", { balance: -2 }]]), treasury: 3 },
    _social: { citedBy, follows, followers, profiles },
  };
}
const snapshot = (S) => JSON.stringify({
  dtus: [...S.dtus].map(([k, v]) => [k, v.parentId, v.lineage]),
  lens: [...S.lensArtifacts.keys()].sort(),
  idx: [...S.lensDomainIndex].map(([k, v]) => [k, [...v].sort()]).sort(),
  wallets: [...S.wallets], eco: [...S.economic.wallets],
  cited: [...S._social.citedBy].map(([k, v]) => [k, [...v].sort()]),
  follows: [...S._social.follows].map(([k, v]) => [k, [...v].sort()]),
  followers: [...S._social.followers].map(([k, v]) => [k, [...v].sort()]),
});
const strip = (r) => { const { timestamp, elapsedMs, ...rest } = r; return rest; };

describe("runIntegrityCheckAsync == runIntegrityCheck", () => {
  it("the fixture exercises every audit (guards against a vacuous comparison)", () => {
    const r = runIntegrityCheck(mkState(), () => {}, { fix: false, verbose: true });
    assert.ok(r.issuesFound.negativeBalances > 0 && r.issuesFound.orphanedLineage > 0 && r.issuesFound.brokenCitations > 0
      && r.issuesFound.unsyncedLens > 0 && r.issuesFound.asymmetricFollows > 0 && r.issuesFound.ghostFollows > 0, JSON.stringify(r.issuesFound));
  });

  for (const options of [{ fix: false, verbose: true }, { fix: true, verbose: true }, { fix: true, verbose: false }]) {
    it(`same summary and same STATE mutations (${JSON.stringify(options)})`, async () => {
      const a = mkState(); const b = mkState();
      const sync = runIntegrityCheck(a, () => {}, options);
      const async_ = await runIntegrityCheckAsync(b, () => {}, options, { sliceMs: 0, checkEvery: 7 }); // yields constantly
      assert.deepEqual(strip(async_), strip(sync));
      assert.equal(snapshot(b), snapshot(a), "identical post-fix STATE");
      if (options.fix) {
        assert.ok(sync.issuesFixed.orphanedLineage > 0 && sync.issuesFixed.unsyncedLens > 0 && sync.issuesFixed.negativeBalances > 0 && sync.issuesFixed.brokenCitations > 0);
        // a second pass over the repaired state finds nothing left to fix for the repaired classes
        const again = await runIntegrityCheckAsync(b, () => {}, { fix: false }, { sliceMs: 0, checkEvery: 7 });
        assert.equal(again.issuesFound.orphanedLineage + again.issuesFound.unsyncedLens + again.issuesFound.negativeBalances + again.issuesFound.brokenCitations, 0);
      }
    });
  }
});

describe("time slicing", () => {
  it("hands the event loop back between slices (and not when the slice is unbounded)", async () => {
    const S = mkState(6000);
    let running = true; let interleaved = 0;
    const spin = () => { interleaved++; if (running) setImmediate(spin); };
    setImmediate(spin);
    await runIntegrityCheckAsync(S, () => {}, { fix: false }, { sliceMs: 0, checkEvery: 100 });
    running = false;
    assert.ok(interleaved >= 40, `other work ran between slices (${interleaved})`);

    running = true; interleaved = 0; setImmediate(spin);
    await runIntegrityCheckAsync(mkState(6000), () => {}, { fix: false }, { sliceMs: 1e12, checkEvery: 100 });
    running = false;
    assert.ok(interleaved <= 3, `no yielding when the slice is unbounded (${interleaved})`);
  });

  it("the longest uninterrupted span is bounded by the slice, not by the store size", async () => {
    const S = mkState(60000);
    const gaps = []; let last = performance.now();
    const probe = () => { const n = performance.now(); gaps.push(n - last); last = n; if (running) setImmediate(probe); };
    let running = true; setImmediate(probe);
    const t0 = performance.now(); runIntegrityCheck(mkState(60000), () => {}, { fix: true }); const syncMs = performance.now() - t0;
    last = performance.now(); gaps.length = 0;
    await runIntegrityCheckAsync(S, () => {}, { fix: true }, { sliceMs: 10, checkEvery: 128 });
    running = false;
    const maxGap = Math.max(...gaps);
    assert.ok(maxGap < Math.max(60, syncMs * 0.5), `max stall ${maxGap.toFixed(0)} ms vs ~${syncMs.toFixed(0)} ms for the synchronous run`);
  });
});

describe("wiring", () => {
  const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
  it("the periodic check is time-sliced and attributed, with a real `fixes` count", () => {
    const i = src.indexOf("const INTEGRITY_INTERVAL");
    const block = src.slice(i, i + 3000).replace(/\/\/.*$/gm, ""); // code only: the explanatory comment quotes the old expression
    assert.match(block, /loopJobs\.withJob\("integrity_check", async \(\) => \{\s*const results = await runIntegrityCheckAsync\(/);
    assert.match(block, /fixes: Object\.values\(results\.issuesFixed \|\| \{\}\)\.reduce/);
    assert.ok(!/results\.fixes \|\| 0/.test(block));
  });
  it("the admin ?run=true route no longer blocks the loop; the startup check is unchanged and synchronous", () => {
    assert.match(src, /results = await runIntegrityCheckAsync\(STATE, log, \{ fix: true, verbose: true \}\);/);
    assert.match(src, /const integrityResults = runIntegrityCheck\(STATE, log, \{ fix: true, verbose: true \}\);/);
  });
});
