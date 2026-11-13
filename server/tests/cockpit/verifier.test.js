import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyStep, pathGet } from "../../lib/cockpit/verifier.js";
import { attestReceipt, resetSigningKeyCache } from "../../lib/receipts/attest.js";

const run = { userId: "u1" };
const V = (tool, result, expects = [], deps) => verifyStep({ db: {}, run, step: { expects }, call: { tool, args: {} }, result: { ok: true, ...result }, deps });
const kinds = (r) => r.checks.filter((c) => !c.pass).map((c) => c.kind);

test("an ok read result passes", async () => {
  const r = await V("web_search", { result: { results: [1] } });
  assert.equal(r.pass, true);
});
test("a write with stub wording fails as fake_success", async () => {
  const r = await V("create_dtu", { result: { message: "mock data, not implemented", dtuId: "d1" } });
  assert.equal(r.pass, false);
  assert.equal(r.errorClass, "fake_success");
});
test("a write with no id fails; with an id passes", async () => {
  const bad = await V("create_dtu", { result: { title: "A" } });
  assert.equal(bad.errorClass, "fake_success");
  const good = await V("create_dtu", { result: { title: "A", dtuId: "d1" } });
  assert.equal(good.pass, true);
});
test("nonempty on an empty list fails and on one item passes", async () => {
  const e = [{ kind: "nonempty", path: "results" }];
  assert.equal((await V("web_search", { result: { results: [] } }, e)).pass, false);
  assert.equal((await V("web_search", { result: { results: [1] } }, e)).pass, true);
});
test("a JSON-string result is read through its path", async () => {
  const r = await V("web_search", { result: JSON.stringify({ results: [{ a: 1 }] }) }, [{ kind: "nonempty", path: "results" }]);
  assert.equal(r.pass, true);
});
test("range 0..10 fails on 11", async () => {
  const r = await V("run_compute", { result: { value: 11 } }, [{ kind: "range", path: "value", min: 0, max: 10 }]);
  assert.equal(r.pass, false);
  assert.deepEqual(kinds(r), ["range"]);
});
test("a failed tool result fails ok", async () => {
  const r = await verifyStep({ db: {}, run, step: { expects: [] }, call: { tool: "web_search", args: {} }, result: { ok: false } });
  assert.equal(r.pass, false);
  assert.ok(kinds(r).includes("ok"));
});

test("receipt: tampered attested receipt fails, untouched passes, unsigned passes with detail", async () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  resetSigningKeyCache();
  try {
    const signed = attestReceipt({ kind: "recipe", value: 5 });
    const e = [{ kind: "receipt" }];
    assert.equal((await V("run_recipe", { result: { receipt: signed } }, e)).pass, true);
    const tampered = { ...signed, value: 6 };
    assert.equal((await V("run_recipe", { result: { receipt: tampered } }, e)).pass, false);
  } finally {
    delete process.env.CONCORD_RECEIPT_SIGNING_KEY;
    resetSigningKeyCache();
  }
  const unsigned = attestReceipt({ kind: "recipe", value: 5 });
  const r = await V("run_recipe", { result: { receipt: unsigned } }, [{ kind: "receipt" }]);
  assert.equal(r.pass, true);
  assert.match(r.checks.find((c) => c.kind === "receipt").detail, /unsigned/);
});

test("judge fails when a citation is unresolved", async () => {
  const verifyClaim = async () => ({ ok: true, verdict: "fabricated_citation", unresolved: ["dtu_abcd"] });
  const r = await V("run_lens_action", { result: { text: "see dtu_abcd" } }, [{ kind: "judge", claim: "x" }], { verifyClaim });
  assert.equal(r.pass, false);
});

test("negative control: 'sample' in a title on a read tool passes", async () => {
  const r = await V("web_search", { result: { title: "A sample of results", results: [1] } });
  assert.equal(r.pass, true);
});

test("pathGet never throws", () => {
  assert.equal(pathGet(null, "a.b"), undefined);
  assert.equal(pathGet({ a: [{ b: 2 }] }, "a.0.b"), 2);
});
