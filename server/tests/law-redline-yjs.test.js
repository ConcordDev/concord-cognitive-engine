// server/tests/law-redline-yjs.test.js
//
// WAVE4 close-out — "No real-time multi-party collaborative redlining"
// (law lens). Pins that the redlining surface REUSES the generic
// scope-parameterized Yjs CRDT layer (server/lib/yjs-realtime.js — the
// same layer `code:liveshare` and `collab:doc` already use) under a new
// `law:contract` scope, rather than standing up a parallel realtime
// transport. Modeled on server/tests/collab-crdt-snapshot.test.js (the
// existing yjs-realtime contract test) for the CRDT half, and on
// server/tests/law-domain-parity.test.js for the law-macro-registration
// half.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import registerLawActions, { clauseTextBlock, lineDiff } from "../domains/law.js";
import { KNOWN_SCOPES, getDoc, encodeStateAsUpdate, applyUpdate } from "../lib/yjs-realtime.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law.${name}`);
  assert.ok(fn, `law.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newContract(ctx = ctxA, over = {}) {
  return call("contract-create", ctx, { title: "Master Services Agreement", type: "services", counterparty: "Acme Co", ...over }).result.contract;
}

describe("law:contract Yjs scope — registration", () => {
  it("KNOWN_SCOPES exposes 'law:contract' alongside the existing code/collab scopes", () => {
    assert.equal(KNOWN_SCOPES.LAW_CONTRACT, "law:contract");
    assert.equal(KNOWN_SCOPES.CODE_LIVESHARE, "code:liveshare");
    assert.equal(KNOWN_SCOPES.COLLAB_DOC, "collab:doc");
  });

  it("law.contract-redline-init reports the same scope constant, not a hand-typed string", () => {
    const c = newContract();
    const r = call("contract-redline-init", ctxA, { id: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, KNOWN_SCOPES.LAW_CONTRACT);
  });
});

describe("law:contract Yjs scope — Y.Doc bind + CRDT convergence", () => {
  it("getDoc('law:contract', contractId) returns an independent bucket from collab:doc/code:liveshare for the same id", () => {
    const c = newContract();
    const lawDoc = getDoc(KNOWN_SCOPES.LAW_CONTRACT, c.id);
    const collabDoc = getDoc(KNOWN_SCOPES.COLLAB_DOC, c.id);
    lawDoc.getText("content").insert(0, "law text");
    assert.equal(lawDoc.getText("content").toString(), "law text");
    // Same docId string, different scope bucket — must not bleed across.
    assert.equal(collabDoc.getText("content").toString(), "");
  });

  it("binds a contract's clause body to Y.Text('content') and two peers converge via applyUpdate", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "Confidentiality", text: "Keep it secret." });
    const init = call("contract-redline-init", ctxA, { id: c.id });
    assert.equal(init.ok, true);
    // The seed text handed to the client is the SAME real helper the
    // version/diff macros use — not a re-derived or fabricated shape.
    assert.equal(init.result.body, clauseTextBlock(c));
    assert.match(init.result.body, /Confidentiality/);

    // contract-redline-init already seeded the server-authoritative Y.Doc
    // with the real body (idempotently, first-open-only — see the
    // handler's comment); confirm that happened instead of re-seeding
    // (a second insert here would double the text, which is exactly the
    // race the server-side seed exists to avoid).
    const serverDoc = getDoc(KNOWN_SCOPES.LAW_CONTRACT, c.id);
    assert.equal(serverDoc.getText("content").toString(), init.result.body);

    // A second "peer" (e.g. a co-counsel's browser tab) starts from the
    // synced state and proposes a redline edit.
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, encodeStateAsUpdate(KNOWN_SCOPES.LAW_CONTRACT, c.id));
    assert.equal(peerDoc.getText("content").toString(), init.result.body);
    peerDoc.getText("content").insert(peerDoc.getText("content").length, "\n\n[ADDED BY CO-COUNSEL]");

    // Peer's update round-trips through the server's applyUpdate exactly
    // like attachYjsSync's `yjs:update` handler does.
    const peerUpdate = Y.encodeStateAsUpdate(peerDoc);
    const applied = applyUpdate(KNOWN_SCOPES.LAW_CONTRACT, c.id, peerUpdate);
    assert.equal(applied.ok, true);

    // Server doc now reflects the redline — CRDT merge, not a fabricated echo.
    assert.match(serverDoc.getText("content").toString(), /ADDED BY CO-COUNSEL/);
  });

  it("seeding is idempotent — a second contract-redline-init never doubles the text", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "Confidentiality", text: "Keep it secret." });
    const first = call("contract-redline-init", ctxA, { id: c.id });
    const second = call("contract-redline-init", ctxA, { id: c.id });
    assert.equal(first.result.body, second.result.body);
    const doc = getDoc(KNOWN_SCOPES.LAW_CONTRACT, c.id);
    assert.equal(doc.getText("content").toString(), first.result.body, "not seeded twice");
  });
});

describe("law.contract-redline-init / -link — collab doc linkage", () => {
  it("reports collabDocId: null until a shadow collab doc is linked", () => {
    const c = newContract();
    const init = call("contract-redline-init", ctxA, { id: c.id });
    assert.equal(init.result.collabDocId, null);
  });

  it("persists a linked collab shadow-doc id and returns it on subsequent inits", () => {
    const c = newContract();
    const link = call("contract-redline-link", ctxA, { id: c.id, collabDocId: "doc_shadow123" });
    assert.equal(link.ok, true);
    assert.equal(link.result.collabDocId, "doc_shadow123");

    const init2 = call("contract-redline-init", ctxA, { id: c.id });
    assert.equal(init2.result.collabDocId, "doc_shadow123");
  });

  it("rejects linking without a collabDocId or against an unknown contract", () => {
    const c = newContract();
    assert.equal(call("contract-redline-link", ctxA, { id: c.id }).ok, false);
    assert.equal(call("contract-redline-link", ctxA, { id: "nope", collabDocId: "x" }).ok, false);
    assert.equal(call("contract-redline-init", ctxA, { id: "nope" }).ok, false);
  });

  it("scopes contracts (and their redline link) per user — user B can't init user A's contract", () => {
    const c = newContract(ctxA);
    assert.equal(call("contract-redline-init", ctxB, { id: c.id }).ok, false);
    assert.equal(call("contract-redline-link", ctxB, { id: c.id, collabDocId: "x" }).ok, false);
  });
});

describe("law.lineDiff export — real engine, used for the tracked-changes UI", () => {
  it("is the exact function contract-diff calls internally (exported, not re-implemented)", () => {
    const ops = lineDiff("line one\nline two", "line one\nline two changed\nline three");
    assert.deepEqual(ops.filter((o) => o.op === "same").map((o) => o.text), ["line one"]);
    assert.ok(ops.some((o) => o.op === "remove" && o.text === "line two"));
    assert.ok(ops.some((o) => o.op === "add" && o.text === "line two changed"));
    assert.ok(ops.some((o) => o.op === "add" && o.text === "line three"));
  });

  it("contract-diff's ops match a direct lineDiff call over the same before/after bodies", () => {
    const c = newContract();
    call("clause-add", ctxA, { contractId: c.id, title: "Confidentiality", text: "Keep it secret." });
    const before = clauseTextBlock(c);
    call("contract-version-save", ctxA, { id: c.id, label: "v1" });
    call("clause-add", ctxA, { contractId: c.id, title: "Governing Law", text: "Laws of NY apply." });
    const after = clauseTextBlock(c);

    const diff = call("contract-diff", ctxA, { id: c.id, fromVersion: 1 });
    assert.equal(diff.ok, true);
    assert.deepEqual(diff.result.ops, lineDiff(before, after));
  });
});
