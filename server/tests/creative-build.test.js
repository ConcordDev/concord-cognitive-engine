// B2 creative fix return (F5 re-pass form) — the package mint's
// caller-scoped status verb. The dedup gate (pipelineCommitDTU) refuses
// any exact-title repeat for a non-user source, and the bench panel
// mints a fixed title ("Production pkg", source creative:pkg:mint), so
// a repeat mint was a guaranteed duplicate_blocked the panel reported
// as "No DTU id.". packageStatus resolves the CALLER's standing
// package so the panel can name it instead of re-firing the create.
import { test } from "node:test";
import assert from "node:assert/strict";
import registerCreativeActions from "../domains/creative.js";

const handlers = {};
registerCreativeActions((domain, name, fn) => { handlers[`${domain}.${name}`] = fn; });
const status = handlers["creative.packageStatus"];
const ctx = (userId) => ({ actor: { userId } });

function withDtus(dtus, fn) {
  const prev = globalThis._concordSTATE;
  globalThis._concordSTATE = { dtus: new Map(dtus.map((d) => [d.id, d])) };
  try { return fn(); } finally {
    if (prev === undefined) delete globalThis._concordSTATE;
    else globalThis._concordSTATE = prev;
  }
}

test("packageStatus: no store available -> honestly not minted", async () => {
  const prev = globalThis._concordSTATE;
  delete globalThis._concordSTATE;
  try {
    const out = await status(ctx("u-1"), { data: {} }, {});
    assert.equal(out.ok, true);
    assert.equal(out.result.minted, false);
  } finally {
    if (prev !== undefined) globalThis._concordSTATE = prev;
  }
});

test("packageStatus: empty store -> not minted", async () => {
  await withDtus([], async () => {
    const out = await status(ctx("u-1"), { data: {} }, {});
    assert.equal(out.result.minted, false);
  });
});

test("packageStatus: the caller's own package resolves with its id", async () => {
  await withDtus(
    [{ id: "dtu_pkg1", title: "Production pkg", source: "creative:pkg:mint", creatorId: "u-1" }],
    async () => {
      const out = await status(ctx("u-1"), { data: {} }, {});
      assert.equal(out.result.minted, true);
      assert.equal(out.result.dtuId, "dtu_pkg1");
    },
  );
});

test("packageStatus: another creator's package never resolves", async () => {
  await withDtus(
    [{ id: "dtu_pkg2", title: "Production pkg", source: "creative:pkg:mint", creatorId: "u-2" }],
    async () => {
      const out = await status(ctx("u-1"), { data: {} }, {});
      assert.equal(out.result.minted, false);
    },
  );
});

test("packageStatus: same title under a different source is not the package", async () => {
  await withDtus(
    [{ id: "dtu_other", title: "Production pkg", source: "user", creatorId: "u-1" }],
    async () => {
      const out = await status(ctx("u-1"), { data: {} }, {});
      assert.equal(out.result.minted, false);
    },
  );
});
