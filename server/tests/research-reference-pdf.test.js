import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

// S4 (F2) — the reader's front door: `reference-pdf` resolves the PDF a
// library reference should render in-app (attached → arXiv → direct →
// Unpaywall), and answers honestly when none exists; `annotation-add`
// carries the reader's structured anchor. Fetch is stubbed per test;
// beforeEach disables the network.

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
  };
}

async function addRef(ctx, params) {
  const r = await call("reference-add", ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.reference;
}

describe("research — reference-pdf (S4 reader resolution)", () => {
  it("an attached PDF wins and is named 'attached' (the review's standing fixture shape)", async () => {
    const ref = await addRef(ctxA, { title: "Mastering the game of Go", year: 2016 });
    const att = await call("reference-attach-pdf", ctxA, {
      referenceId: ref.id, url: "https://arxiv.org/pdf/1706.03762.pdf", filename: "1706.03762.pdf",
    });
    assert.equal(att.ok, true, JSON.stringify(att));
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.pdfUrl, "https://arxiv.org/pdf/1706.03762.pdf");
    assert.equal(r.result.source, "attached");
    assert.equal(r.result.filename, "1706.03762.pdf");
    assert.equal(r.result.attachmentId, att.result.attachment.id);
  });

  it("an attachment served from the platform artifact store is named 'upload'", async () => {
    const ref = await addRef(ctxA, { title: "My uploaded paper" });
    const att = await call("reference-attach-pdf", ctxA, {
      referenceId: ref.id, url: "/api/artifact/dtu_abc123/stream", filename: "paper.pdf",
    });
    assert.equal(att.ok, true, JSON.stringify(att));
    // …while other relative URLs stay refused by the attach validation.
    const bad = await call("reference-attach-pdf", ctxA, {
      referenceId: ref.id, url: "/somewhere/else.pdf", filename: "x.pdf",
    });
    assert.equal(bad.ok, false);
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.result.pdfUrl, "/api/artifact/dtu_abc123/stream");
    assert.equal(r.result.source, "upload");
  });

  it("derives the arXiv PDF from an arXiv DOI with no network call", async () => {
    const ref = await addRef(ctxA, { title: "Attention Is All You Need", doi: "10.48550/arXiv.1706.03762" });
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; throw new Error("must not be called"); };
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.pdfUrl, "https://arxiv.org/pdf/1706.03762.pdf");
    assert.equal(r.result.source, "arxiv");
    assert.equal(fetched, false);
  });

  it("derives the arXiv PDF from an arxiv.org/abs URL on the record", async () => {
    const ref = await addRef(ctxA, { title: "Attention (url form)", url: "https://arxiv.org/abs/1706.03762" });
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.result.pdfUrl, "https://arxiv.org/pdf/1706.03762.pdf");
    assert.equal(r.result.source, "arxiv");
  });

  it("a record URL that already points at a .pdf is used directly, ahead of any lookup", async () => {
    const ref = await addRef(ctxA, { title: "Direct PDF", doi: "10.1000/xyz123", url: "https://example.org/files/paper.pdf" });
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; throw new Error("must not be called"); };
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.result.pdfUrl, "https://example.org/files/paper.pdf");
    assert.equal(r.result.source, "direct");
    assert.equal(fetched, false);
  });

  it("resolves a DOI through Unpaywall's best_oa_location.url_for_pdf", async () => {
    const ref = await addRef(ctxA, { title: "An open access paper", doi: "10.1371/journal.pone.0000001" });
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return jsonResponse(200, {
        doi: "10.1371/journal.pone.0000001", is_oa: true,
        best_oa_location: { url_for_pdf: "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000001&type=printable" },
        oa_locations: [],
      });
    };
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(seen[0], /^https:\/\/api\.unpaywall\.org\/v2\/10\.1371%2Fjournal\.pone\.0000001\?email=/);
    assert.equal(r.result.source, "unpaywall");
    assert.equal(r.result.pdfUrl, "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000001&type=printable");
  });

  it("falls back to a later oa_location when best_oa_location carries no PDF", async () => {
    const ref = await addRef(ctxA, { title: "OA in second location", doi: "10.1000/oa2" });
    globalThis.fetch = async () => jsonResponse(200, {
      is_oa: true,
      best_oa_location: { url_for_pdf: null, url: "https://example.org/landing" },
      oa_locations: [{ url_for_pdf: null }, { url_for_pdf: "https://repo.example.org/paper.pdf" }],
    });
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.result.source, "unpaywall");
    assert.equal(r.result.pdfUrl, "https://repo.example.org/paper.pdf");
  });

  it("Unpaywall answers no-OA → honest no_open_access_pdf, no fabricated URL", async () => {
    const ref = await addRef(ctxA, { title: "Paywalled", doi: "10.1038/nature16961" });
    globalThis.fetch = async () => jsonResponse(200, { is_oa: false, best_oa_location: null, oa_locations: [] });
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.pdfUrl, null);
    assert.equal(r.result.reason, "no_open_access_pdf");
  });

  it("Unpaywall 404 (DOI unknown to it) is a definitive no-OA answer, not an error", async () => {
    const ref = await addRef(ctxA, { title: "Obscure DOI", doi: "10.9999/unknown" });
    globalThis.fetch = async () => jsonResponse(404, { error: true });
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.pdfUrl, null);
    assert.equal(r.result.reason, "no_open_access_pdf");
  });

  it("Unpaywall unreachable → lookup_failed, never mislabelled as no_open_access_pdf", async () => {
    const ref = await addRef(ctxA, { title: "Lookup outage", doi: "10.1000/down" });
    globalThis.fetch = async () => { throw new Error("socket hangup"); };
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.pdfUrl, null);
    assert.equal(r.result.reason, "lookup_failed");
  });

  it("a reference with no PDF path at all gets the honest no-PDF answer", async () => {
    const ref = await addRef(ctxA, { title: "Just a book" });
    const r = await call("reference-pdf", ctxA, { referenceId: ref.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.pdfUrl, null);
    assert.equal(r.result.reason, "no_open_access_pdf");
  });

  it("missing reference → not found; another user's reference → not found", async () => {
    const ref = await addRef(ctxA, { title: "Mine only" });
    const missing = await call("reference-pdf", ctxA, { referenceId: "ref_nope" });
    assert.equal(missing.ok, false);
    const other = await call("reference-pdf", ctxB, { referenceId: ref.id });
    assert.equal(other.ok, false);
    assert.equal(other.error, "reference not found");
  });
});

describe("research — annotation anchor (S4)", () => {
  it("stores a structured anchor and mirrors its page onto the record", async () => {
    const ref = await addRef(ctxA, { title: "Anchored" });
    const r = await call("annotation-add", ctxA, {
      referenceId: ref.id, quote: "Attention is all you need.", text: "the thesis",
      anchor: { page: 3, startOffset: 120, endOffset: 148 },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.result.annotation.anchor, { page: 3, startOffset: 120, endOffset: 148 });
    assert.equal(r.result.annotation.page, 3);
    const list = await call("annotation-list", ctxA, { referenceId: ref.id });
    assert.deepEqual(list.result.annotations[0].anchor, { page: 3, startOffset: 120, endOffset: 148 });
    const detail = await call("reference-detail", ctxA, { id: ref.id });
    assert.deepEqual(detail.result.annotations[0].anchor, { page: 3, startOffset: 120, endOffset: 148 });
  });

  it("an explicit page param wins over the anchor's page for the top-level field", async () => {
    const ref = await addRef(ctxA, { title: "Both pages" });
    const r = await call("annotation-add", ctxA, {
      referenceId: ref.id, quote: "q", page: 5, anchor: { page: 3, startOffset: null, endOffset: null },
    });
    assert.equal(r.result.annotation.page, 5);
    assert.deepEqual(r.result.annotation.anchor, { page: 3, startOffset: null, endOffset: null });
  });

  it("page-only anchors (this build's reader) store null offsets", async () => {
    const ref = await addRef(ctxA, { title: "Reader-made" });
    const r = await call("annotation-add", ctxA, {
      referenceId: ref.id, quote: "passage", anchor: { page: 7 },
    });
    assert.deepEqual(r.result.annotation.anchor, { page: 7, startOffset: null, endOffset: null });
    assert.equal(r.result.annotation.page, 7);
  });

  it("junk anchors are dropped, inverted offsets are nulled, the annotation still files", async () => {
    const ref = await addRef(ctxA, { title: "Junk anchor" });
    const junk = await call("annotation-add", ctxA, {
      referenceId: ref.id, quote: "q1", anchor: { page: -2, startOffset: "x", endOffset: {} },
    });
    assert.equal(junk.ok, true, JSON.stringify(junk));
    assert.equal("anchor" in junk.result.annotation, false);
    const inverted = await call("annotation-add", ctxA, {
      referenceId: ref.id, quote: "q2", anchor: { page: 2, startOffset: 90, endOffset: 10 },
    });
    assert.deepEqual(inverted.result.annotation.anchor, { page: 2, startOffset: null, endOffset: null });
  });

  it("annotations without an anchor keep exactly their previous shape", async () => {
    const ref = await addRef(ctxA, { title: "Legacy shape" });
    const r = await call("annotation-add", ctxA, { referenceId: ref.id, page: 4, quote: "typed quote", text: "typed note" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal("anchor" in r.result.annotation, false);
    assert.equal(r.result.annotation.page, 4);
    assert.equal(r.result.annotation.quote, "typed quote");
  });
});
