// tests/depth/notary-behavior.test.js — REAL behavioral tests for the notary
// domain. Uses a LOCAL SHIM (the domain is not yet globally registered in the
// boot harness) so the tests run standalone, fast, and deterministically.
//
// The notary domain powers the de-demo'd NotarizationPanel with REAL data: a
// genuine SHA-256 content hash + an honest local hash-chain (NOT a blockchain,
// NO fabricated tx hash). These tests pin the exact hash value, the chain
// linkage, tamper detection, round-trip, and validation rejections.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import register from "../../domains/notary.js";

// Local shim: collect the handlers register() installs, expose a runner that
// mirrors the (ctx, {data}, params) handler signature.
const H = new Map();
register((d, a, fn) => H.set(a, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

describe("notary — REAL sha256 + honest hash-chain", () => {
  it("notarize: computes the exact known sha256 of the content", () => {
    const r = run("notarize", {}, { content: "hello world", title: "Greeting" });
    assert.equal(r.ok, true);
    // Known vector: sha256("hello world")
    assert.equal(
      r.result.record.contentHash,
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
    assert.equal(r.result.record.contentHash, sha("hello world"));
    assert.equal(r.result.record.title, "Greeting");
    assert.equal(r.result.record.prevHash, null); // first record in the chain
    // Honest: no fabricated on-chain transaction hash on the record.
    assert.ok(!("txHash" in r.result.record));
  });

  it("notarize: prevHash links each record to the user's previous record (hash-chain)", () => {
    const ctx = { actor: { userId: "chain-user" } };
    const first = run("notarize", {}, { content: "block one" }, ctx);
    const second = run("notarize", {}, { content: "block two" }, ctx);
    assert.equal(first.result.record.prevHash, null);
    assert.equal(second.result.record.prevHash, first.result.record.contentHash);
    assert.equal(second.result.record.contentHash, sha("block two"));
  });

  it("notarize: empty content is rejected", () => {
    const empty = run("notarize", {}, { content: "" });
    assert.equal(empty.ok, false);
    assert.ok(empty.error.includes("content"));
    const missing = run("notarize", {}, {});
    assert.equal(missing.ok, false);
  });
});

describe("notary — verify (tamper detection) + round-trip", () => {
  it("verify: matching content is valid; tampered content is not", () => {
    const ctx = { actor: { userId: "verify-user" } };
    const created = run("notarize", {}, { content: "original document" }, ctx);
    const recordId = created.result.record.id;

    const good = run("verify", {}, { recordId, content: "original document" }, ctx);
    assert.equal(good.ok, true);
    assert.equal(good.result.valid, true);
    assert.equal(good.result.expectedHash, created.result.record.contentHash);
    assert.equal(good.result.actualHash, good.result.expectedHash);

    const tampered = run("verify", {}, { recordId, content: "original document!" }, ctx);
    assert.equal(tampered.ok, true);
    assert.equal(tampered.result.valid, false);
    assert.notEqual(tampered.result.actualHash, tampered.result.expectedHash);
    assert.equal(tampered.result.expectedHash, created.result.record.contentHash);
  });

  it("verify: an unknown recordId is rejected", () => {
    const bad = run("verify", {}, { recordId: "ntr_nope", content: "x" });
    assert.equal(bad.ok, false);
    assert.ok(bad.error.includes("not found"));
  });

  it("records-list + record-get round-trip (newest-first); missing id rejected", () => {
    const ctx = { actor: { userId: "list-user" } };
    const a = run("notarize", {}, { content: "doc A", title: "A" }, ctx);
    const b = run("notarize", {}, { content: "doc B", title: "B" }, ctx);

    const list = run("records-list", {}, {}, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 2);
    // Newest-first: the second-notarized record leads.
    assert.equal(list.result.records[0].id, b.result.record.id);
    assert.equal(list.result.records[1].id, a.result.record.id);
    assert.ok(list.result.records.some((r) => r.id === a.result.record.id));

    const got = run("record-get", {}, { recordId: a.result.record.id }, ctx);
    assert.equal(got.ok, true);
    assert.equal(got.result.record.contentHash, sha("doc A"));

    const found = list.result.records.find((r) => r.id === a.result.record.id);
    assert.equal(found.title, "A");

    const missing = run("record-get", {}, { recordId: "ntr_absent" }, ctx);
    assert.equal(missing.ok, false);
    assert.ok(missing.error.includes("not found"));
  });

  it("records are per-user scoped (one user cannot see another's records)", () => {
    const u1 = { actor: { userId: "scope-1" } };
    const u2 = { actor: { userId: "scope-2" } };
    run("notarize", {}, { content: "u1 secret" }, u1);
    const list2 = run("records-list", {}, {}, u2);
    assert.equal(list2.result.count, 0);
  });
});
