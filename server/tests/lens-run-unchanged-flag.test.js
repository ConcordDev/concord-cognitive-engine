// /api/lens/run must keep `unchanged:true` when it peels a success envelope.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("lens/run unchanged flag", () => {
  it("passes unchanged:true through when the envelope is peeled", () => {
    const { status, body } = shapeLensRunHttp({ ok: true, unchanged: true, result: { bill: { id: "b1" } } });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.unchanged, true);
    assert.equal(body.result.unchanged, true);
    assert.deepEqual(body.result.bill, { id: "b1" });
  });
  it("keeps it when there is no inner result envelope", () => {
    const { body } = shapeLensRunHttp({ ok: true, unchanged: true });
    assert.equal(body.result.unchanged, true);
  });
  it("does not invent the flag for a normal success", () => {
    const { body } = shapeLensRunHttp({ ok: true, result: { bill: { id: "b1" } } });
    assert.equal(body.unchanged, undefined);
    assert.equal(body.result.unchanged, undefined);
  });
  it("does not mutate the handler's object", () => {
    const inner = { bill: { id: "b1" } };
    shapeLensRunHttp({ ok: true, unchanged: true, result: inner });
    assert.equal(inner.unchanged, undefined);
  });
});
