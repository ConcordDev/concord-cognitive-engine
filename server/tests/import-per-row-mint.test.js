// Behavior tests for FIX-import-002 (import domain half): committing a
// correction session must mint ONE DTU per row. Before the fix, commit
// marked the session committed and created nothing — a pasted JSON
// array or CSV import produced zero items. Pins:
//   1. a 2-row session (the ticket's JSON-array shape) commits into 2
//      dtu/create calls, each titled from its row and carrying the row
//      in meta; result.imported = 2 with both ids.
//   2. a title,content CSV-shaped row mints with the content as the
//      DTU content (the ticket's CSV leg).
//   3. when every mint refuses, commit reports failure and leaves the
//      session UNcommitted (no silent "0 imported" success).
//   4. with no macro runner the commit still succeeds but reports
//      minting "unavailable-no-macro-runner" instead of pretending.
// Hermetic: importdomain registers into a capture map; dtu/create is a
// recording stub at the ctx.macro boundary.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const registerImportActions = (await import("../domains/importdomain.js")).default;

const actions = new Map();
registerImportActions((domain, name, fn) => actions.set(`${domain}/${name}`, fn));
const call = (name, ctx, params) => actions.get(`import/${name}`)(ctx, {}, params);

globalThis._concordSTATE = {};

function recordingCtx(failAll = false) {
  const creates = [];
  return {
    creates,
    ctx: {
      actor: { userId: "user-a" },
      macro: {
        run: async (domain, action, spec) => {
          assert.equal(domain, "dtu");
          assert.equal(action, "create");
          creates.push(spec);
          if (failAll) return { ok: false, error: "validation_failed" };
          return { ok: true, id: `dtu_${creates.length}` };
        },
      },
    },
  };
}

test("a JSON-array session commits into one DTU per element", async () => {
  const { ctx, creates } = recordingCtx();
  const started = await call("startCorrectionSession", ctx, {
    name: "Array import",
    rows: [{ title: "Alpha", content: "first" }, { title: "Beta", content: "second" }],
    schema: { title: { type: "string", required: true }, content: { type: "string" } },
  });
  const id = started.result.session.id;
  const committed = await call("commitCorrectionSession", ctx, { id });
  assert.equal(committed.ok, true);
  assert.equal(committed.result.imported, 2);
  assert.deepEqual(committed.result.dtuIds, ["dtu_1", "dtu_2"]);
  assert.equal(creates.length, 2);
  assert.equal(creates[0].title, "Alpha");
  assert.equal(creates[0].content, "first");
  assert.deepEqual(creates[1].meta.row, { title: "Beta", content: "second" });
  assert.equal(creates[0].meta.kind, "imported-record");
});

test("a title,content CSV-shaped row mints with its content", async () => {
  const { ctx, creates } = recordingCtx();
  const started = await call("startCorrectionSession", ctx, {
    rows: [{ title: "Solo", content: "the one csv row" }],
    schema: { title: { type: "string", required: true }, content: { type: "string", required: true } },
  });
  const committed = await call("commitCorrectionSession", ctx, { id: started.result.session.id });
  assert.equal(committed.ok, true);
  assert.equal(committed.result.imported, 1);
  assert.equal(creates[0].content, "the one csv row");
});

test("when every mint refuses, commit fails honestly and stays uncommitted", async () => {
  const { ctx } = recordingCtx(true);
  const started = await call("startCorrectionSession", ctx, {
    rows: [{ title: "Nope", content: "x" }],
    schema: { title: { type: "string", required: true } },
  });
  const id = started.result.session.id;
  const committed = await call("commitCorrectionSession", ctx, { id });
  assert.equal(committed.ok, false);
  assert.match(committed.error, /no rows could be imported/);
  const after = await call("listCorrectionSessions", ctx, {});
  assert.equal(after.result.sessions.find((x) => x.id === id).committed, false);
});

test("no macro runner: commit succeeds but reports minting unavailable", async () => {
  const ctx = { actor: { userId: "user-a" } };
  const started = await call("startCorrectionSession", ctx, {
    rows: [{ title: "Solo", content: "x" }],
    schema: {},
  });
  const committed = await call("commitCorrectionSession", ctx, { id: started.result.session.id });
  assert.equal(committed.ok, true);
  assert.equal(committed.result.imported, 0);
  assert.equal(committed.result.minting, "unavailable-no-macro-runner");
});
