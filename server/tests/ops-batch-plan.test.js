import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, fileExclusion, selectBatch, MAX_BATCH } from "../../scripts/ops/batch-plan.mjs";

test("parseVerdict reads head, the last verdict, backend-only and deployed", () => {
  const ship = parseVerdict("# PR\nReviewer: x. Head 53813b086, main 1\nVERDICT: SHIP (BE deploy alone)\n");
  assert.deepEqual([ship.head, ship.ship, ship.shipBackend, ship.deployed], ["53813b086", true, true, false]);
  assert.equal(parseVerdict("Head abc1234\nVERDICT: HOLD (conflicts)").ship, false);
  assert.equal(parseVerdict("Head abc1234\nVERDICT: SHIP FE\n").shipBackend, false);
  assert.equal(parseVerdict("Head abc1234\nVERDICT: SHIP BE\nVERDICT result: DEPLOYED BE 18:04").deployed, true);
  const redo = parseVerdict("Head abc1234\nVERDICT: HOLD\nVERDICT: SHIP (BE deploy alone)");
  assert.equal(redo.ship, true, "the last verdict wins");
});

test("fileExclusion keeps server.js, auth/security, migrations, deps and frontend out; tests and server libs are fine", () => {
  assert.equal(fileExclusion(["server/lib/chat/progress.js", "server/tests/x.test.js"]), null);
  assert.match(fileExclusion(["server/server.js"]), /server\.js/);
  assert.match(fileExclusion(["server/lib/auth-tokens.js"]), /auth\/security/);
  assert.match(fileExclusion(["server/migrations/493_x.js"]), /migration/);
  assert.match(fileExclusion(["server/package.json"]), /dependencies/);
  assert.match(fileExclusion(["concord-frontend/components/a.tsx"]), /not backend-only/);
  assert.match(fileExclusion([".github/workflows/ci.yml"]), /auth\/security|not backend-only/);
});

test("selectBatch takes at most four, never two PRs that share a file", () => {
  const prs = [
    { n: 1, files: ["a.js"] }, { n: 2, files: ["a.js", "b.js"] }, { n: 3, files: ["c.js"] },
    { n: 4, files: ["d.js"] }, { n: 5, files: ["e.js"] }, { n: 6, files: ["f.js"] },
  ];
  const { picked, skipped } = selectBatch(prs);
  assert.deepEqual(picked.map((p) => p.n), [1, 3, 4, 5]);
  assert.equal(picked.length, MAX_BATCH);
  assert.match(skipped.find((s) => s.n === 2).reason, /overlap with #1/);
  assert.match(skipped.find((s) => s.n === 6).reason, /batch full/);
  assert.equal(selectBatch(prs, 2).picked.length, 2);
});

test("trial merge runs in a temp clone: no prclean-only refusal, --repo is never checked out or fetched into", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../scripts/ops/batch-plan.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes('endsWith("/prclean")'), "any --repo is accepted");
  assert.ok(!/git\(repo, "(checkout|fetch|merge|branch)"/.test(src), "--repo is only read");
  assert.match(src, /mkdtempSync\(path\.join\(os\.tmpdir\(\)/);
  assert.match(src, /fs\.rmSync\(work/, "temp clone removed in finally, also on conflict or test failure");
});
